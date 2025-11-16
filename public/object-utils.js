const HttpError = require("./HttpError");

function isObject(val) {
    return val != null && typeof val === "object" && Array.isArray(val) === false;
}

/**
 * Deep set value using dot separated `path` of the object.
 * @param object {Object} Any JS object.
 * @param path {String} String like "input.docs.0.file"
 * @param value {*} The value we set.
 * @ignore
 * @private
 */
function deepSet(object, path, value) {
    const props = path.split("."); // E.g. "input.docs.0.file" -> ["input", "docs", "0", "file"]
    let lastProp = props.pop();
    if (lastProp === "__proto__") throw new HttpError(400, `Detected GraphQL query with path "${path}" as a hacker attack.`);
    for (const prop of props) {
        if (!prop) throw new HttpError(400, `Invalid object path "${path}".`)
        if (prop === "__proto__") throw new HttpError(400, `Detected GraphQL query with path "${path}" as a hacker attack.`);
        object = object[prop];
        if (!object) throw new HttpError(400, `The path "${path}" was not found in the GraphQL query.`);
    }
    object[lastProp] = value;
}

module.exports = { isObject, deepSet };
