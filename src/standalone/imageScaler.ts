/** The MCP image scaler for Node, where the plugin's canvas-based one has no
 *  browser to run in. `sharp` decodes, fits the image inside the edge limit
 *  and re-encodes, with the same output rules as the canvas scaler: JPEG stays
 *  JPEG, anything else that has to change becomes PNG, and an image that is
 *  small enough and already model-readable goes through untouched. */

import sharp from "sharp";
import {
  fitWithin,
  ModelReadableImageTypes,
  outputTypeFor,
  type ImageScaler,
  type ScaledImage,
} from "../imageScaling";

export class SharpImageScaler implements ImageScaler {
  async scale(bytes: ArrayBuffer, mimeType: string, maxEdge: number): Promise<ScaledImage> {
    const input = Buffer.from(bytes);
    // `autoOrient` applies the EXIF rotation, so width and height are the
    // ones a viewer shows.
    const image = sharp(input, { animated: false, failOn: "error" }).autoOrient();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Could not read the image's dimensions.");
    }
    const rotated = (metadata.orientation ?? 1) >= 5;
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;
    const fitted = fitWithin(width, height, maxEdge);
    if (!fitted.scaled && ModelReadableImageTypes.has(mimeType) && !rotated) {
      return { data: input, mimeType, width, height, transformed: false };
    }
    const outputType = outputTypeFor(mimeType);
    const resized = image.resize(fitted.width, fitted.height, { fit: "fill" });
    const encoded =
      outputType === "image/jpeg" ? resized.jpeg({ quality: 85 }) : resized.png();
    const data = await encoded.toBuffer();
    return {
      data,
      mimeType: outputType,
      width: fitted.width,
      height: fitted.height,
      transformed: true,
    };
  }
}
