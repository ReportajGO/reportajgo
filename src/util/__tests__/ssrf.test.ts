import { describe, expect, it } from "vitest";
import { isPrivateIp, isPubliclyFetchableUrl } from "../ssrf.js";

describe("isPubliclyFetchableUrl", () => {
  it("accepts real public origins", () => {
    expect(isPubliclyFetchableUrl("https://reportagego.com/agent/media/a.png")).toBe(true);
    expect(isPubliclyFetchableUrl("http://reportajgo.uz/media/a.png")).toBe(true);
    expect(isPubliclyFetchableUrl("https://bucket.s3.us-east-1.amazonaws.com/media/a.png")).toBe(true);
    expect(isPubliclyFetchableUrl("https://8.8.8.8/a.png")).toBe(true);
  });

  it("rejects the URLs an unset PUBLIC_BASE_URL produces", () => {
    // The default base — this is what put broken covers on live articles.
    expect(isPubliclyFetchableUrl("http://localhost:3010/media/a.png")).toBe(false);
    expect(isPubliclyFetchableUrl("http://127.0.0.1:3010/media/a.png")).toBe(false);
    expect(isPubliclyFetchableUrl("http://[::1]:3010/media/a.png")).toBe(false);
  });

  it("rejects addresses that only resolve inside the compose network", () => {
    // Docker service names are single-label, so no reader can resolve them.
    expect(isPubliclyFetchableUrl("http://backend-app:3010/media/a.png")).toBe(false);
    expect(isPubliclyFetchableUrl("http://frontend:3000/uploads/a.png")).toBe(false);
    expect(isPubliclyFetchableUrl("http://172.18.0.4:3010/media/a.png")).toBe(false);
    expect(isPubliclyFetchableUrl("http://10.0.0.5/media/a.png")).toBe(false);
    expect(isPubliclyFetchableUrl("http://192.168.1.20/media/a.png")).toBe(false);
  });

  it("rejects anything that isn't an http(s) URL", () => {
    expect(isPubliclyFetchableUrl("/media/a.png")).toBe(false);
    expect(isPubliclyFetchableUrl("s3://bucket/media/a.png")).toBe(false);
    expect(isPubliclyFetchableUrl("file:///app/media/a.png")).toBe(false);
    expect(isPubliclyFetchableUrl("")).toBe(false);
  });
});

describe("isPrivateIp", () => {
  it("covers the ranges a public cover must never point at", () => {
    expect(isPrivateIp("169.254.169.254")).toBe(true); // cloud metadata
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("100.64.0.1")).toBe(true); // CGNAT
    expect(isPrivateIp("1.1.1.1")).toBe(false);
  });
});
