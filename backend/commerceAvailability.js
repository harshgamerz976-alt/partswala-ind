import {
  COMMERCE_UNAVAILABLE_CODE,
  COMMERCE_UNAVAILABLE_MESSAGE,
  CUSTOMER_COMMERCE_ENABLED,
} from "../shared/commerceAvailability.js";

export function rejectDisabledCommerce(response) {
  if (CUSTOMER_COMMERCE_ENABLED) return false;
  response.status(503).json({
    code: COMMERCE_UNAVAILABLE_CODE,
    message: COMMERCE_UNAVAILABLE_MESSAGE,
  });
  return true;
}
