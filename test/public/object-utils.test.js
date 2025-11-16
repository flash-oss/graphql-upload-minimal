const { throws, strictEqual } = require("assert");
const { deepSet } = require("../../public/object-utils");

describe("object-utils", () => {
    it("should not allow broken paths", async () => {
        throws(() => deepSet({}, ".", "BADFOOD"), {
            name: "BadRequestError",
            message: 'Invalid object path ".".',
            status: 400,
        });
        throws(() => deepSet({ aaa: {} }, "aaa..bbb", "BADFOOD"), {
            name: "BadRequestError",
            message: 'Invalid object path "aaa..bbb".',
            status: 400,
        });
    });

    it("should not allow missing paths", async () => {
        throws(() => deepSet({ exist: { foo: null } }, "unexist.foo", "BADFOOD"), {
            name: "BadRequestError",
            message: 'The path "unexist.foo" was not found in the GraphQL query.',
            status: 400,
        });

        throws(() => deepSet({ exist: {} }, "exist.unexist.foo", "BADFOOD"), {
            name: "BadRequestError",
            message: 'The path "exist.unexist.foo" was not found in the GraphQL query.',
            status: 400,
        });
    });

    it("should not prototype pollute", async () => {
        const query = { bla: {} };

        const func1 = () => deepSet(query, "bla.__proto__.foo", "BADFOOD");
        throws(func1, {
            name: "BadRequestError",
            message: 'Detected GraphQL query with path "bla.__proto__.foo" as a hacker attack.',
            status: 400,
        });

        const func2 = () => deepSet(query, "__proto__.isAdmin", "BADFOOD");
        throws(func2, {
            name: "BadRequestError",
            message: 'Detected GraphQL query with path "__proto__.isAdmin" as a hacker attack.',
            status: 400,
        });
    });

    it("should set deep path", async () => {
        const query = { bla: {} };

        deepSet(query, "bla.foo", "OKAY");

        strictEqual(query.bla.foo, "OKAY");
    });
});
