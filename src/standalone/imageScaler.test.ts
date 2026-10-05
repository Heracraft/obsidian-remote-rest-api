import sharp from "sharp";
import { SharpImageScaler } from "./imageScaler";

async function image(width: number, height: number, format: "png" | "jpeg" | "webp"): Promise<ArrayBuffer> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 10, b: 10 } },
  })
    .toFormat(format)
    .toBuffer();
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe("SharpImageScaler", () => {
  const scaler = new SharpImageScaler();

  test("passes a small model-readable image through untouched", async () => {
    const bytes = await image(10, 20, "png");
    const result = await scaler.scale(bytes, "image/png", 1568);
    expect(result).toMatchObject({ mimeType: "image/png", width: 10, height: 20, transformed: false });
    expect(Buffer.compare(result.data, Buffer.from(bytes))).toBe(0);
  });

  test("fits a large image inside the edge, keeping JPEG as JPEG", async () => {
    const result = await scaler.scale(await image(400, 100, "jpeg"), "image/jpeg", 100);
    expect(result).toMatchObject({ mimeType: "image/jpeg", width: 100, height: 25, transformed: true });
    expect((await sharp(result.data).metadata()).width).toBe(100);
  });

  test("re-encodes a type the model cannot read as PNG", async () => {
    const result = await scaler.scale(await image(5, 5, "webp"), "image/bmp", 1568);
    expect(result).toMatchObject({ mimeType: "image/png", width: 5, height: 5, transformed: true });
  });

  test("rejects bytes that are not an image", async () => {
    await expect(scaler.scale(new TextEncoder().encode("nope").buffer, "image/png", 1568)).rejects.toThrow();
  });
});
