const { doesNotThrow, strictEqual } = require("assert");
const ignoreStream = require("../../public/ignore-stream");
const CountReadableStream = require("../CountReadableStream");

describe("ignoreStream", () => {
    it("`ignoreStream` ignores errors.", () => {
        doesNotThrow(() => {
            const stream = new CountReadableStream();
            ignoreStream(stream);
            stream.emit("error", new Error("Message."));
        });
    });

    it("`ignoreStream` resumes a paused stream.", () => {
        const stream = new CountReadableStream();
        stream.pause();
        ignoreStream(stream);
        strictEqual(stream.isPaused(), false);
    });
});
