"use strict";

const { ok, strictEqual, rejects } = require("assert");
const { Readable } = require("stream");
const FormData = require("form-data");
const { Upload, processRequest } = require("../..");
const streamToString = require("../streamToString");

describe("processRequest serverless", () => {
    describe("data validation", () => {
        it("should throw if headers do not have right content-type", async () => {
            const badContentType = (headerValue) => ({
                name: "BadRequestError",
                message: `Invalid content-type ${headerValue}, should be multipart/form-data;`,
                status: 400,
                expose: true,
            });

            const stream = new Readable();
            await rejects(processRequest(stream), badContentType(undefined));
            stream.headers = null;
            await rejects(processRequest(stream), badContentType(null));
            stream.headers = {};
            await rejects(processRequest(stream), badContentType(undefined));
            stream.headers = { "content-type": null };
            await rejects(processRequest(stream), badContentType(null));
            stream.headers = { "content-type": "plain/text" };
            await rejects(processRequest(stream), badContentType("plain/text"));
        });

        it("should throw if GCF request has no .rawBody", async () => {
            const badRequest = (message) => ({
                name: "BadRequestError",
                message,
                status: 400,
                expose: true,
            });

            await rejects(
                processRequest({ headers: { "content-type": "multipart/form-data;" } }, {}, { environment: "gcf" }),
                badRequest(
                    "GCF req.rawBody is missing. See docs: https://cloud.google.com/functions/docs/writing/http#multipart_data"
                )
            );
            await rejects(
                processRequest(
                    {
                        headers: { "content-type": "multipart/form-data;" },
                        rawBody: null,
                    },
                    {},
                    { environment: "gcf" }
                ),
                badRequest(
                    "GCF req.rawBody is missing. See docs: https://cloud.google.com/functions/docs/writing/http#multipart_data"
                )
            );
        });

        it("should throw if Azure request has no .body", async () => {
            const badRequest = (message) => ({
                name: "BadRequestError",
                message,
                status: 400,
                expose: true,
            });

            await rejects(
                processRequest(
                    { req: { headers: { "content-type": "multipart/form-data;" } } },
                    {},
                    { environment: "azure" }
                ),
                badRequest(
                    "Azure Function req.body is missing. See this page for more info: https://docs.microsoft.com/en-us/azure/azure-functions/functions-reference-node"
                )
            );
            await rejects(
                processRequest(
                    {
                        req: {
                            headers: { "content-type": "multipart/form-data;" },
                            body: null,
                        },
                    },
                    {},
                    { environment: "azure" }
                ),
                badRequest(
                    "Azure Function req.body is missing. See this page for more info: https://docs.microsoft.com/en-us/azure/azure-functions/functions-reference-node"
                )
            );
        });

        it("should throw if AWS Lambda event has no .body", async () => {
            const badRequest = (message) => ({
                name: "BadRequestError",
                message,
                status: 400,
                expose: true,
            });

            await rejects(
                processRequest({ headers: { "content-type": "multipart/form-data;" } }, null, {
                    environment: "lambda",
                }),
                badRequest(
                    "AWS Lambda req.body is missing. See these screenshots how to set it up: https://github.com/myshenin/aws-lambda-multipart-parser/blob/98ed57e55cf66b2053cf6c27df37a9243a07826a/README.md"
                )
            );
            await rejects(
                processRequest(
                    {
                        headers: { "content-type": "multipart/form-data;" },
                        rawBody: null,
                    },
                    null,
                    { environment: "lambda" }
                ),
                badRequest(
                    "AWS Lambda req.body is missing. See these screenshots how to set it up: https://github.com/myshenin/aws-lambda-multipart-parser/blob/98ed57e55cf66b2053cf6c27df37a9243a07826a/README.md"
                )
            );
        });

        it("should throw trying to do serverless in non-serverless environment", async () => {
            const badRequest = (message) => ({
                name: "BadRequestError",
                message,
                status: 400,
                expose: true,
            });

            await rejects(
                processRequest({ headers: { "content-type": "multipart/form-data;" } }),
                badRequest(
                    "The request doesn't look like a ReadableStream. Tip: use `environment` option to enable serverless functions support."
                )
            );
            await rejects(
                processRequest({
                    headers: { "content-type": "multipart/form-data;" },
                    rawBody: null,
                }),
                badRequest(
                    "The request doesn't look like a ReadableStream. Tip: use `environment` option to enable serverless functions support."
                )
            );
        });
    });

    describe("data processing", () => {
        it('`processRequest` with environment="lambda"', async () => {
            const body = new FormData();

            body.append("operations", JSON.stringify({ variables: { file: null } }));
            body.append("map", JSON.stringify({ 1: ["variables.file"] }));
            body.append("1", "a", { filename: "a.txt" });

            // Create a fake Lambda event
            const event = {
                body: body.getBuffer().toString(),
                headers: body.getHeaders(),
            };

            const operation = await processRequest(event, null, {
                environment: "lambda",
            });

            ok(operation.variables.file instanceof Upload);

            const upload = await operation.variables.file.promise;

            strictEqual(upload.filename, "a.txt");
            strictEqual(upload.mimetype, "text/plain");
            strictEqual(upload.encoding, "7bit");

            const stream = upload.createReadStream();

            ok(stream instanceof Readable);
            strictEqual(stream._readableState.encoding, null);
            strictEqual(stream.readableHighWaterMark, 16384);
            strictEqual(await streamToString(stream), "a");
        });

        it('`processRequest` with environment="gcf"', async () => {
            const body = new FormData();

            body.append("operations", JSON.stringify({ variables: { file: null } }));
            body.append("map", JSON.stringify({ 1: ["variables.file"] }));
            body.append("1", "a", { filename: "a.txt" });

            // Create a fake request
            const event = {
                rawBody: body.getBuffer(),
                headers: body.getHeaders(),
            };

            const operation = await processRequest(event, null, {
                environment: "gcf",
            });

            ok(operation.variables.file instanceof Upload);

            const upload = await operation.variables.file.promise;

            strictEqual(upload.filename, "a.txt");
            strictEqual(upload.mimetype, "text/plain");
            strictEqual(upload.encoding, "7bit");

            const stream = upload.createReadStream();

            ok(stream instanceof Readable);
            strictEqual(stream._readableState.encoding, null);
            strictEqual(stream.readableHighWaterMark, 16384);
            strictEqual(await streamToString(stream), "a");
        });

        it('`processRequest` with environment="azure" (context)', async () => {
            const body = new FormData();

            body.append("operations", JSON.stringify({ variables: { file: null } }));
            body.append("map", JSON.stringify({ 1: ["variables.file"] }));
            body.append("1", "a", { filename: "a.txt" });

            // Create a fake request
            const req = {
                body: body.getBuffer(),
                headers: body.getHeaders(),
            };
            const context = { req };

            const operation = await processRequest(context, null, {
                environment: "azure",
            });

            ok(operation.variables.file instanceof Upload);

            const upload = await operation.variables.file.promise;

            strictEqual(upload.filename, "a.txt");
            strictEqual(upload.mimetype, "text/plain");
            strictEqual(upload.encoding, "7bit");

            const stream = upload.createReadStream();

            ok(stream instanceof Readable);
            strictEqual(stream._readableState.encoding, null);
            strictEqual(stream.readableHighWaterMark, 16384);
            strictEqual(await streamToString(stream), "a");
        });

        it('`processRequest` with environment="azure" (return)', async () => {
            const body = new FormData();

            body.append("operations", JSON.stringify({ variables: { file: null } }));
            body.append("map", JSON.stringify({ 1: ["variables.file"] }));
            body.append("1", "a", { filename: "a.txt" });

            // Create a fake request
            const req = {
                body: body.getBuffer(),
                headers: body.getHeaders(),
            };
            const context = {};

            const operation = await processRequest(context, req, {
                environment: "azure",
            });

            ok(operation.variables.file instanceof Upload);

            const upload = await operation.variables.file.promise;

            strictEqual(upload.filename, "a.txt");
            strictEqual(upload.mimetype, "text/plain");
            strictEqual(upload.encoding, "7bit");

            const stream = upload.createReadStream();

            ok(stream instanceof Readable);
            strictEqual(stream._readableState.encoding, null);
            strictEqual(stream.readableHighWaterMark, 16384);
            strictEqual(await streamToString(stream), "a");
        });
    });
});
