const errorNames = {
    400: "BadRequestError",
    413: "PayloadTooLargeError",
    499: "BadRequestError",
    500: "InternalError",
};

module.exports = class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
        this.expose = true;
        this.name = errorNames[status];
    }
};
