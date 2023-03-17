# graphql-upload-minimal

[![npm version](https://badgen.net/npm/v/graphql-upload-minimal)](https://npm.im/graphql-upload-minimal) [![CI status](https://github.com/flash-oss/graphql-upload-minimal/workflows/CI/badge.svg)](https://github.com/flash-oss/graphql-upload-minimal/actions)

Minimalistic and developer friendly middleware and an [`Upload` scalar](#class-graphqlupload) to add support for [GraphQL multipart requests](https://github.com/jaydenseric/graphql-multipart-request-spec) (file uploads via queries and mutations) to various Node.js GraphQL servers.

## Acknowledgements

This module was ⚠️ forked from the amazing [`graphql-upload`](https://npm.im/graphql-upload). The original module is exceptionally well documented and well written. It was very easy to fork and amend. Thanks Jayden!

I needed something simpler which won't attempt doing any disk I/O. There were no server-side JavaScript alternative modules for GraphQL file uploads. Thus, this fork was born.

### Differences to [`graphql-upload`](https://npm.im/graphql-upload)

#### Single production dependency - `busboy`

- Results in 9 less production dependencies.
- And 6 less MB in your `node_modules`.
- And using a bit less memory.
- And a bit faster.
- Most importantly, less risk that one of the dependencies would break your server.

#### More standard and developer friendly exception messages

Using ASCII-only text. Direct developers to resolve common mistakes.

#### **Does not create any temporary files on disk**

- Thus works faster.
- Does not have a risk of clogging your file system. Even on high load.
- No need to manually destroy the programmatically aborted streams.

#### Does not follow strict [specification](https://github.com/jaydenseric/graphql-multipart-request-spec)

You can't have same file referenced twice in a GraphQL query/mutation.

#### API changes comparing to the original `graphql-upload`

- Does not accept any arguments to `createReadStream()`. Will **throw** if any provided.
- Calling `createReadStream()` more than once per file is not allowed. Will **throw**.

Otherwise, **this module is a drop-in replacement for the `graphql-upload`**.

## Support

The following environments are known to be compatible:

- [Node.js](https://nodejs.org) versions 12, 14, 16, and 18. It works in Node 10 even though the unit tests fail.
- [AWS Lambda](https://aws.amazon.com/lambda/). [Reported](https://github.com/flash-oss/graphql-upload-minimal/issues/4#issuecomment-664234726) to be working.
- [Google Cloud Functions (GCF)](https://cloud.google.com/functions) Experimental. Untested.
- [Azure Functions](https://azure.microsoft.com/en-us/services/functions/) Working.
- [Koa](https://koajs.com)
- [Express.js](https://expressjs.com)

See also [GraphQL multipart request spec server implementations](https://github.com/jaydenseric/graphql-multipart-request-spec#server).

## Setup

To install [`graphql-upload-minimal`](https://npm.im/graphql-upload-minimal) and the [`graphql`](https://npm.im/graphql) peer dependency from [npm](https://npmjs.com) run:

```shell
npm install graphql-upload-minimal graphql
```

Use the [`graphqlUploadKoa`](#function-graphqluploadkoa) or [`graphqlUploadExpress`](#function-graphqluploadexpress) middleware just before GraphQL middleware. Alternatively, use [`processRequest`](#function-processrequest) to create a custom middleware.

A schema built with separate SDL and resolvers (e.g. using [`makeExecutableSchema`](https://apollographql.com/docs/graphql-tools/generate-schema#makeExecutableSchema)) requires the [`Upload` scalar](#class-graphqlupload) to be setup.

## Usage

[Clients implementing the GraphQL multipart request spec](https://github.com/jaydenseric/graphql-multipart-request-spec#client) upload files as [`Upload` scalar](#class-graphqlupload) query or mutation variables. Their resolver values are promises that resolve [file upload details](#type-fileupload) for processing and storage. Files are typically streamed into cloud storage but may also be stored in the filesystem.

### Express.js

Minimalistic code example showing how to upload a file along with arbitrary GraphQL data and save it to an S3 bucket.

Express.js middleware. You must put it before the main GraphQL sever middleware. Also, **make sure there is no other Express.js middleware which parses `multipart/form-data`** HTTP requests before the `graphqlUploadExpress` middleware!

```js
const express = require("express");
const expressGraphql = require("express-graphql");
const { graphqlUploadExpress } = require("graphql-upload-minimal");

express()
  .use(
    "/graphql",
    graphqlUploadExpress({ maxFileSize: 10000000, maxFiles: 10 }),
    expressGraphql({ schema: require("./my-schema") })
  )
  .listen(3000);
```

GraphQL schema:

```graphql
scalar Upload
input DocumentUploadInput {
  docType: String!
  file: Upload!
}

type SuccessResult {
  success: Boolean!
  message: String
}
type Mutations {
  uploadDocuments(docs: [DocumentUploadInput!]!): SuccessResult
}
```

GraphQL resolvers:

```js
const { S3 } = require("aws-sdk");

const resolvers = {
  Upload: require("graphql-upload-minimal").GraphQLUpload,

  Mutations: {
    async uploadDocuments(root, { docs }, ctx) {
      try {
        const s3 = new S3({ apiVersion: "2006-03-01", params: { Bucket: "my-bucket" } });

        for (const doc of docs) {
          const { createReadStream, filename /*, fieldName, mimetype, encoding */ } = await doc.promise;
          const Key = `${ctx.user.id}/${doc.docType}-${filename}`;
          await s3.upload({ Key, Body: createReadStream() }).promise();
        }

        return { success: true };
      } catch (error) {
        console.log("File upload failed", error);
        return { success: false, message: error.message };
      }
    },
  },
};
```

### Koa

See the [example Koa server and client](https://github.com/jaydenseric/apollo-upload-examples).

### AWS Lambda

[Reported](https://github.com/flash-oss/graphql-upload-minimal/issues/4#issuecomment-664234726) to be working.

```js
const { processRequest } = require("graphql-upload-minimal");

module.exports.processRequest = function (event) {
  return processRequest(event, null, { environment: "lambda" });
};
```

### Google Cloud Functions (GCF)

Possible example. Experimental. Untested.

```js
const { processRequest } = require("graphql-upload-minimal");

exports.uploadFile = function (req, res) {
  return processRequest(req, res, { environment: "gcf" });
};
```

### Azure Functions

Possible example. Working.

```js
const { processRequest } = require("graphql-upload-minimal");

exports.uploadFile = function (context, req) {
  return processRequest(context, req, { environment: "azure" });
};
```

### Uploading multiple files

When uploading multiple files you can make use of the `fieldName` property to keep track of an identifier of the uploaded files. The `fieldName` is equal to the passed `name` property of the file in the `multipart/form-data` request. This can be modified to contain an identifier (like a UUID), for example using the `formDataAppendFile` in the commonly used [`apollo-upload-link`](https://github.com/jaydenseric/apollo-upload-client#function-formdataappendfile) library.

## Tips

- Only use [`createReadStream()`](#type-fileupload) _before_ the resolver returns; late calls (e.g. in an unawaited async function or callback) throw an error.

## Architecture

The [GraphQL multipart request spec](https://github.com/jaydenseric/graphql-multipart-request-spec) allows a file to be used for multiple query or mutation variables (file deduplication), and for variables to be used in multiple places. GraphQL resolvers need to be able to manage independent file streams.

[`busboy`](https://npm.im/busboy) parses multipart request streams. Once the `operations` and `map` fields have been parsed, [`Upload` scalar](#class-graphqlupload) values in the GraphQL operations are populated with promises, and the operations are passed down the middleware chain to GraphQL resolvers.
