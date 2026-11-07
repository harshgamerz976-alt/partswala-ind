import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMERCE_UNAVAILABLE_CODE,
  COMMERCE_UNAVAILABLE_MESSAGE,
  CUSTOMER_COMMERCE_ENABLED,
} from "../shared/commerceAvailability.js";
import { rejectDisabledCommerce } from "./commerceAvailability.js";

test("customer checkout, order placement, payments, and shipping remain disabled", () => {
  assert.equal(CUSTOMER_COMMERCE_ENABLED, false);
  let statusCode;
  let responseBody;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  assert.equal(rejectDisabledCommerce(response), true);
  assert.equal(statusCode, 503);
  assert.deepEqual(responseBody, {
    code: COMMERCE_UNAVAILABLE_CODE,
    message: COMMERCE_UNAVAILABLE_MESSAGE,
  });
});
