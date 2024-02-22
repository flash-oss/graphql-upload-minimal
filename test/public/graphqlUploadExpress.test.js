const { deepStrictEqual, ok, strictEqual } = require("assert");
const express = require("express");
const FormData = require("form-data");
const HttpError = require("../../public/HttpError");
const fetch = require("node-fetch");
const { graphqlUploadExpress, processRequest } = require("../..");
const listen = require("../listen");

describe("graphqlUploadExpress", () => {
    it("`graphqlUploadExpress` with a non multipart request.", async () => {
        let processRequestRan = false;

        const app = express().use(
            graphqlUploadExpress({
                async processRequest() {
                    processRequestRan = true;
                },
            })
        );

        const { port, close } = await listen(app);

        try {
            await fetch(`http://localhost:${port}`, { method: "POST" });
            strictEqual(processRequestRan, false);
        } finally {
            close();
        }
    });

    it("`graphqlUploadExpress` with a multipart request.", async () => {
        let requestBody;

        const app = express()
            .use(graphqlUploadExpress())
            .use((request, response, next) => {
                requestBody = request.body;
                next();
            });

        const { port, close } = await listen(app);

        try {
            const body = new FormData();

            body.append("operations", JSON.stringify({ variables: { file: null } }));
            body.append("map", JSON.stringify({ 1: ["variables.file"] }));
            body.append("1", "a", { filename: "a.txt" });

            await fetch(`http://localhost:${port}`, { method: "POST", body });

            ok(requestBody);
            ok(requestBody.variables);
            ok(requestBody.variables.file);
        } finally {
            close();
        }
    });

    it("`graphqlUploadExpress` with a multipart request and option `processRequest`.", async () => {
        let processRequestRan = false;
        let requestBody;

        const app = express()
            .use(
                graphqlUploadExpress({
                    processRequest(...args) {
                        processRequestRan = true;
                        return processRequest(...args);
                    },
                })
            )
            .use((request, response, next) => {
                requestBody = request.body;
                next();
            });

        const { port, close } = await listen(app);

        try {
            const body = new FormData();

            body.append("operations", JSON.stringify({ variables: { file: null } }));
            body.append("map", JSON.stringify({ 1: ["variables.file"] }));
            body.append("1", "a", { filename: "a.txt" });

            await fetch(`http://localhost:${port}`, { method: "POST", body });

            strictEqual(processRequestRan, true);
            ok(requestBody);
            ok(requestBody.variables);
            ok(requestBody.variables.file);
        } finally {
            close();
        }
    });

    it("`graphqlUploadExpress` with a multipart request and option `processRequest` throwing an exposed HTTP error.", async () => {
        let expressError;
        let responseStatusCode;

        const error = new HttpError(400, "Message.");
        const app = express()
            .use(
                graphqlUploadExpress({
                    async processRequest(request) {
                        request.resume();
                        throw error;
                    },
                })
            )
            .use((error, request, response, next) => {
                expressError = error;
                responseStatusCode = response.statusCode;

                // Sending a response here prevents the default Express error handler
                // from running, which would undesirably (in this case) display the
                // error in the console.
                if (response.headersSent) next(error);
                else response.send();
            });

        const { port, close } = await listen(app);

        try {
            const body = new FormData();

            body.append("operations", JSON.stringify({ variables: { file: null } }));
            body.append("map", JSON.stringify({ 1: ["variables.file"] }));
            body.append("1", "a", { filename: "a.txt" });

            await fetch(`http://localhost:${port}`, { method: "POST", body });

            deepStrictEqual(expressError, error);
            strictEqual(responseStatusCode, error.status);
            strictEqual(responseStatusCode, error.statusCode);
        } finally {
            close();
        }
    });

    it("`graphqlUploadExpress` with a multipart request following middleware throwing an error.", async () => {
        let expressError;

        const error = new Error("Message.");
        const app = express()
            .use(graphqlUploadExpress())
            .use(() => {
                throw error;
            })
            .use((error, request, response, next) => {
                expressError = error;

                // Sending a response here prevents the default Express error handler
                // from running, which would undesirably (in this case) display the
                // error in the console.
                if (response.headersSent) next(error);
                else response.send();
            });

        const { port, close } = await listen(app);

        try {
            const body = new FormData();

            body.append("operations", JSON.stringify({ variables: { file: null } }));
            body.append("map", JSON.stringify({ 1: ["variables.file"] }));
            body.append("1", "a", { filename: "a.txt" });

            await fetch(`http://localhost:${port}`, { method: "POST", body });

            deepStrictEqual(expressError, error);
        } finally {
            close();
        }
    });
});
