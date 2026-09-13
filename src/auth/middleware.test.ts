import { describe, expect, it, vi } from "vitest";
import { Request, Response } from "express";
import { Role } from "@prisma/client";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { requireAdmin, requireAuth } from "./middleware";

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("requireAuth", () => {
  it("rejects a request with no Authorization header", () => {
    const req = { headers: {} } as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a malformed Authorization header (no Bearer prefix)", () => {
    const req = { headers: { authorization: "not-a-bearer-token" } } as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid/garbage token", () => {
    const req = { headers: { authorization: "Bearer garbage.token.here" } } as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign({ sub: 1, role: Role.USER }, config.jwtSecret, { expiresIn: "-1s" });
    const req = { headers: { authorization: `Bearer ${expired}` } } as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a valid token and attaches req.auth", () => {
    const token = jwt.sign({ sub: 7, role: Role.USER }, config.jwtSecret, { expiresIn: "15m" });
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.auth).toEqual({ id: 7, role: Role.USER });
  });
});

describe("requireAdmin", () => {
  it("rejects a non-admin user with 403", () => {
    const req = { auth: { id: 1, role: Role.USER } } as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a request with no auth at all", () => {
    const req = {} as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows an admin user through", () => {
    const req = { auth: { id: 1, role: Role.ADMIN } } as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
