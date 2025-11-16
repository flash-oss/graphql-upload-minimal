"use strict";

const busboy = require("busboy");
const ignoreStream = require("./ignore-stream");
const Upload = require("./Upload");
const HttpError = require("./HttpError");
const { isObject, deepSet } = require("./object-utils");

/**
 * Official [GraphQL multipart request spec](https://github.com/jaydenseric/graphql-multipart-request-spec)
 * URL. Useful for error messages, etc.
 * @kind constant
 * @name SPEC_URL
 * @type {string}
 * @ignore
 */
const SPEC_URL = "https://github.com/jaydenseric/graphql-multipart-request-spec";

const noop = () => {};

/**
 * Processes a [GraphQL multipart request](https://github.com/jaydenseric/graphql-multipart-request-spec).
 * It parses the `operations` and `map` fields to create an
 * [`Upload`]{@link Upload} instance for each expected file upload, placing
 * references wherever the file is expected in the
 * [GraphQL operation]{@link GraphQLOperation} for the
 * [`Upload` scalar]{@link GraphQLUpload} to derive its value. Error objects
 * have HTTP `status` property and an appropriate HTTP error `name` property.
 * @kind function
 * @name processRequest
 * @type {ProcessRequestFunction}
 * @example <caption>Ways to `import`.</caption>
 * ```js
 * import { processRequest } from 'graphql-upload-minimal';
 * ```
 *
 * ```js
 * import processRequest from 'graphql-upload-minimal/public/processRequest.js';
 * ```
 * @example <caption>Ways to `require`.</caption>
 * ```js
 * const { processRequest } = require('graphql-upload-minimal');
 * ```
 *
 * ```js
 * const processRequest = require('graphql-upload-minimal/public/processRequest');
 * ```
 */
module.exports = async function processRequest(
    req,
    res,
    {
        maxFieldSize = 1000000, // 1 MB
        maxFileSize = Infinity,
        maxFiles = Infinity,
        environment, // "lambda", "gcf", "azure"
    } = {}
) {
    if (environment === "gcf") {
        // Google Cloud Functions compatibility.
        if (!req.rawBody)
            throw new HttpError(
                400,
                "GCF req.rawBody is missing. See docs: https://cloud.google.com/functions/docs/writing/http#multipart_data"
            );
    } else if (environment === "lambda") {
        // AWS Lambda compatibility
        if (!req.body)
            throw new HttpError(
                400,
                "AWS Lambda req.body is missing. See these screenshots how to set it up: https://github.com/myshenin/aws-lambda-multipart-parser/blob/98ed57e55cf66b2053cf6c27df37a9243a07826a/README.md"
            );
    } else if (environment === "azure") {
        // Azure Functions compatibility
        req = req.req || res;
        if (!req || !req.body)
            throw new HttpError(
                400,
                "Azure Function req.body is missing. See this page for more info: https://docs.microsoft.com/en-us/azure/azure-functions/functions-reference-node"
            );
    } else {
        // Regular node.js environment where request is a ReadableStream instance.
        if (!req || !req.pipe || !req.unpipe || !req.once || !req.resume)
            throw new HttpError(
                400,
                "The request doesn't look like a ReadableStream. Tip: use `environment` option to enable serverless functions support."
            );
    }

    const contentType = req && req.headers && req.headers["content-type"];
    if (typeof contentType !== "string" || !contentType.includes("multipart/form-data;")) {
        throw new HttpError(400, `Invalid content-type ${contentType}, should be multipart/form-data;`);
    }

    // ReadableStream mocking
    if (!req.pipe) req.pipe = noop;
    if (!req.unpipe) req.unpipe = noop;
    if (!req.once) req.once = noop;
    if (!req.resume) req.resume = noop;

    return new Promise((resolve, reject) => {
        const parser = busboy({
            headers: req.headers,
            defParamCharset: "utf8",
            limits: {
                fieldSize: maxFieldSize,
                fields: 2, // Only operations and map.
                fileSize: maxFileSize,
                files: maxFiles,
            },
        });

        let exitError;
        let lastFileStream;
        /**
         * Exits request processing with an error. Successive calls have no effect.
         * @kind function
         * @name processRequest~exit
         * @param {string|Error} message Error message or error object.
         * @param {number} [status=400] HTTP status code.
         * @private
         * @ignore
         */
        const exit = (message, status = 400) => {
            // None of the tested scenarios cause multiple calls of this function, but
            // it’s still good to guard against it happening in case it’s possible now
            // or in the future.
            // coverage ignore next line
            if (exitError) return;

            let isParserError = false;
            if (message instanceof Error) {
                isParserError = true;
                exitError = message;
            } else {
                exitError = new HttpError(status, message);
            }

            reject(exitError);

            // If the error came from the parser, don’t cause it to be emitted again.
            isParserError ? parser.destroy() : parser.destroy(exitError);

            if (lastFileStream && !lastFileStream.readableEnded && !lastFileStream.destroyed) {
                lastFileStream.destroy(exitError);
            }

            if (map) for (const upload of map.values()) if (!upload.file) upload.reject(exitError);

            req.unpipe(parser);

            // With a sufficiently large request body, subsequent events in the same
            // event frame cause the stream to pause after the parser is destroyed. To
            // ensure that the request resumes, the call to .resume() is scheduled for
            // later in the event loop.
            setImmediate(() => {
                req.resume();
            });
        };

        let operations;
        let map;
        parser.on("field", (fieldName, value, { valueTruncated /*, nameTruncated, encoding, mimeType */ }) => {
            if (valueTruncated)
                return exit(
                    `The '${fieldName}' multipart field value exceeds the ${maxFieldSize} byte size limit.`,
                    413
                );

            switch (fieldName) {
                case "operations":
                    try {
                        operations = JSON.parse(value);
                    } catch (error) {
                        return exit(`Invalid JSON in the 'operations' multipart field (${SPEC_URL}).`);
                    }

                    if (!isObject(operations) && !Array.isArray(operations))
                        return exit(`Invalid type for the 'operations' multipart field (${SPEC_URL}).`);

                    break;
                case "map": {
                    if (!operations)
                        return exit(`Misordered multipart fields; 'map' should follow 'operations' (${SPEC_URL}).`);

                    let parsedMap;
                    try {
                        parsedMap = JSON.parse(value);
                    } catch (error) {
                        return exit(`Invalid JSON in the 'map' multipart field (${SPEC_URL}).`);
                    }

                    if (!isObject(parsedMap)) return exit(`Invalid type for the 'map' multipart field (${SPEC_URL}).`);

                    const mapEntries = Object.entries(parsedMap);

                    // Check max files is not exceeded, even though the number of files to
                    // parse might not match th(e map provided by the client.
                    if (mapEntries.length > maxFiles) return exit(`${maxFiles} max file uploads exceeded.`, 413);

                    map = new Map();
                    for (const [fieldName, paths] of mapEntries) {
                        if (!Array.isArray(paths))
                            return exit(
                                `Invalid type for the 'map' multipart field entry key '${fieldName}' array (${SPEC_URL}).`
                            );

                        map.set(fieldName, new Upload());

                        for (const [index, path] of paths.entries()) {
                            if (typeof path !== "string" || !path.trim())
                                return exit(
                                    `Invalid type for the 'map' multipart field entry key '${fieldName}' array index '${index}' value (${SPEC_URL}).`
                                );

                            try {
                                deepSet(operations, path, map.get(fieldName));
                            } catch (error) {
                                return exit(
                                    `Invalid object path for the 'map' multipart field entry key '${fieldName}' array index '${index}' value '${path}' (${SPEC_URL}).`
                                );
                            }
                        }
                    }

                    resolve(operations);
                }
            }
        });

        let returnedStreams = new Set();
        parser.on("file", (fieldName, stream, { filename, encoding, mimeType: mimetype }) => {
            lastFileStream = stream;

            if (!map) {
                ignoreStream(stream);
                return exit(`Misordered multipart fields; files should follow 'map' (${SPEC_URL}).`);
            }

            const upload = map.get(fieldName);

            if (!upload) {
                // The file is extraneous. As the rest can still be processed, just
                // ignore it and don't exit with an error.
                ignoreStream(stream);
                return;
            }

            let fileError;

            stream.on("limit", () => {
                fileError = new HttpError(413, `File truncated as it exceeds the ${maxFileSize} byte size limit.`);
                stream.unpipe();
            });

            stream.on("error", (error) => {
                fileError = error;
                stream.unpipe();
            });

            const file = {
                fieldName,
                filename,
                mimetype,
                encoding,
                createReadStream(...args) {
                    if (args && args.some(Boolean)) {
                        throw new Error(
                            "graphql-upload-minimal does not support createReadStream() arguments. Use graphql-upload NPM module if you need this feature."
                        );
                    }

                    const error = fileError || (released ? exitError : null);
                    if (error) throw error;

                    if (returnedStreams.has(stream)) {
                        throw new Error(
                            "graphql-upload-minimal does not allow calling createReadStream() multiple times. Please, consume the previously returned stream. Make sure you're not referencing same file twice in your query."
                        );
                    } else {
                        returnedStreams.add(stream);
                        return stream;
                    }
                },
            };

            upload.resolve(file);
        });

        parser.once("filesLimit", () => exit(`${maxFiles} max file uploads exceeded.`, 413));

        parser.once("close", () => {
            req.unpipe(parser);
            req.resume();

            if (!operations && !map) {
                return exit(
                    `graphql-upload-minimal couldn't find any files or JSON. Looks like another middleware had processed this multipart request. Or maybe you are running in a cloud serverless function? Then see README.md.`,
                    500
                );
            }

            if (!operations) return exit(`Missing multipart field 'operations' (${SPEC_URL}).`);

            if (!map) return exit(`Missing multipart field 'map' (${SPEC_URL}).`);

            for (const upload of map.values())
                if (!upload.file) upload.reject(new HttpError(400, "File missing in the request."));
        });

        parser.once("error", exit);

        let released;
        /**
         * Successive calls have no effect.
         * @kind function
         * @name processRequest~release
         * @ignore
         */
        const release = () => {
            released = true;
        };

        if (res && res.once) {
            res.once("close", release);
        }

        req.once("close", () => {
            if (!req.readableEnded) exit("Request disconnected during file upload stream parsing.", 499);
        });

        if (environment === "gcf") {
            parser.end(req.rawBody);
            release(); // the response was released by the cloud earlier, somewhere at the Gateway level.
        } else if (environment === "lambda" || environment === "azure") {
            parser.end(req.body);
            release(); // the response was released by the cloud earlier, somewhere at the Gateway level.
        } else {
            req.pipe(parser);
        }
    });
};
