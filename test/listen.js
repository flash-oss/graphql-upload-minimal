/**
 * Starts a Node.js HTTP server.
 * @kind function
 * @name listen
 * @param {object} app Node.js HTTP server.
 * @returns {Promise<{port: number, close: Function}>} Resolves the port the server is listening on, and a server close function.
 * @ignore
 */
module.exports = function listen(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(function (error) {
            if (error) reject(error);
            else
                resolve({
                    port: server.address().port,
                    close: () => server.close(),
                });
        });
    });
};
