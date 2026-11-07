import test from "node:test";
import assert from "node:assert/strict";
import { allowedAssistantTools, assistantRoleFor, canUseAssistantTool } from "./authorization.js";

test("assistant roles require server-authorized identities", () => {
  assert.equal(assistantRoleFor({ user: null }), "customer");
  assert.equal(assistantRoleFor({ user: { uid: "a" }, profile: { role: "vendor", vendorStatus: "pending" } }), "customer");
  assert.equal(assistantRoleFor({ user: { uid: "a" }, profile: { role: "vendor", vendorStatus: "approved" } }), "vendor");
  assert.equal(assistantRoleFor({ user: { uid: "a" }, isAdmin: true }), "admin");
});

test("tool permissions are explicit and deny unknown roles or tools", () => {
  assert.equal(canUseAssistantTool("customer", "getOrders"), true);
  assert.equal(canUseAssistantTool("customer", "getAdminFinance"), false);
  assert.equal(canUseAssistantTool("vendor", "getVendorPayout"), true);
  assert.equal(canUseAssistantTool("vendor", "getAdminFinance"), false);
  assert.equal(canUseAssistantTool("admin", "getAdminFinance"), true);
  assert.equal(canUseAssistantTool("unknown", "getOrders"), false);
  assert.deepEqual(allowedAssistantTools("unknown"), allowedAssistantTools("customer"));
});

test("assistant cannot add to cart, access carts, or arrange shipping while commerce is disabled", () => {
  for (const role of ["customer", "vendor", "admin"]) {
    for (const tool of ["getShippingEstimate", "getCart", "addToCart", "removeFromCart"]) {
      assert.equal(canUseAssistantTool(role, tool), false, `${role} must not use ${tool}`);
    }
  }
  assert.equal(canUseAssistantTool("customer", "searchProducts"), true);
  assert.equal(canUseAssistantTool("vendor", "getVendorPayout"), true);
});