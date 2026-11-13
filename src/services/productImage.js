const RESPONSIVE_IMAGE_WIDTHS = [320, 640, 960];
const CLOUDINARY_UPLOAD_PATH = "/image/upload/";

function cloudinaryVariant(source, width) {
  const url = new URL(source);
  const uploadIndex = url.pathname.indexOf(CLOUDINARY_UPLOAD_PATH);
  if (uploadIndex < 0) return null;

  const pathAfterUpload = url.pathname.slice(uploadIndex + CLOUDINARY_UPLOAD_PATH.length);
  if (pathAfterUpload.split("/")[0]?.startsWith("s--")) return null;

  const transformation = `f_auto,q_auto,w_${width},c_limit/`;
  url.pathname = `${url.pathname.slice(0, uploadIndex + CLOUDINARY_UPLOAD_PATH.length)}${transformation}${pathAfterUpload}`;
  return url.toString();
}

export function getResponsiveProductImage(source) {
  if (typeof source !== "string" || !source.trim()) return null;
  const original = source.trim();

  try {
    const url = new URL(original);
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com") {
      return { src: original, srcSet: "", sizes: "" };
    }

    const variants = RESPONSIVE_IMAGE_WIDTHS.map((width) => ({
      width,
      url: cloudinaryVariant(original, width),
    }));
    if (variants.some((variant) => !variant.url)) {
      return { src: original, srcSet: "", sizes: "" };
    }
    return {
      src: variants[1].url,
      srcSet: variants.map(({ width, url: imageUrl }) => `${imageUrl} ${width}w`).join(", "),
      sizes: "(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw",
    };
  } catch {
    return { src: original, srcSet: "", sizes: "" };
  }
}