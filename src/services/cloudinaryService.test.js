import assert from "node:assert/strict";
import test from "node:test";
import { File } from "node:buffer";
import { uploadAuthenticatedImageToBackend } from "./authenticatedImageUpload.js";

test("authenticated media upload sends the file through the backend proxy", async () => {
  let requestUrl;
  let requestOptions;
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "part.jpg", { type: "image/jpeg" });
  const imageUrl = await uploadAuthenticatedImageToBackend(file, "profile", {
    user: { async getIdToken() { return "test-id-token"; } },
    apiUrl: "https://backend.example.test",
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return {
        ok: true,
        status: 201,
        async json() {
          return { imageUrl: "https://res.cloudinary.com/test/image/upload/profile.jpg" };
        },
      };
    },
  });

  assert.equal(imageUrl, "https://res.cloudinary.com/test/image/upload/profile.jpg");
  assert.equal(requestUrl, "https://backend.example.test/api/uploads/cloudinary");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers.Authorization, "Bearer test-id-token");
  assert.equal(requestOptions.body.get("purpose"), "profile");
  assert.equal(requestOptions.body.get("file").name, "part.jpg");
});

test("media upload requires authentication and surfaces backend errors", async () => {
  const file = new File([new Uint8Array([1])], "part.jpg", { type: "image/jpeg" });
  await assert.rejects(uploadAuthenticatedImageToBackend(file, "profile"), /Sign in/);

  await assert.rejects(uploadAuthenticatedImageToBackend(file, "profile", {
    user: { async getIdToken() { return "test-id-token"; } },
    apiUrl: "https://backend.example.test",
    fetchImpl: async () => ({
      ok: false,
      status: 413,
      async json() { return { message: "Images must be no larger than 8 MB." }; },
    }),
  }), /no larger than 8 MB/);
});

test("media upload rejects malformed success responses and network errors", async () => {
  const file = new File([new Uint8Array([1])], "part.jpg", { type: "image/jpeg" });
  const options = {
    user: { async getIdToken() { return "test-id-token"; } },
    apiUrl: "https://backend.example.test",
  };
  await assert.rejects(uploadAuthenticatedImageToBackend(file, "profile", {
    ...options,
    fetchImpl: async () => ({ ok: true, async json() { return { imageUrl: "http://example.test/part.jpg" }; } }),
  }), /secure image URL/);
  await assert.rejects(uploadAuthenticatedImageToBackend(file, "profile", {
    ...options,
    fetchImpl: async () => { throw new Error("network detail"); },
  }), /Could not reach the image service/);
});
