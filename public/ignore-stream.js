/**
 * Safely ignores a Node.js readable stream.
 * @kind function
 * @name ignoreStream
 * @param {ReadableStream} stream Node.js readable stream.
 * @private
 * @ignore
 */
module.exports = function ignoreStream(stream) {
    // Prevent an unhandled error from crashing the process.
    stream.on("error", () => {});

    // Waste the stream.
    stream.resume();
};
