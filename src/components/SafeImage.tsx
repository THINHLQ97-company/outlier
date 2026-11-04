import { useState, type ImgHTMLAttributes } from "react";
import { ImageOff } from "lucide-react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  /** URL đã xử lý sẵn ở nơi gọi (dùng imageDisplayUrl như `<img>` cũ); component không đổi URL. */
  src?: string | null;
  variant?: "avatar" | "thumbnail";
  /** Tên dùng lấy chữ cái đầu + màu nền cho avatar dự phòng. */
  name?: string;
};
const COLORS = ["#4338ca", "#0369a1", "#0f766e", "#7e22ce", "#be185d", "#b45309"];
export function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return COLORS[hash % COLORS.length];
}

// Class chiều cao cố định (h-14, sm:h-20, aspect-square, size-*) — `h-auto` và `max-h-*` thì không.
const FIXED_HEIGHT = /(?:^|\s)(?:[a-z0-9-]+:)?(?:h-(?!auto\b)|aspect-|size-)/;

/** Keying the inner view by URL resets the error state whenever src changes. */
export default function SafeImage(props: Props) {
  return <SafeImageView key={props.src || "empty"} {...props} />;
}

function SafeImageView({ src, alt = "", variant = "thumbnail", name, className = "", style, onLoad, onError, ...rest }: Props) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");

  if (!src || state === "error") {
    const isAvatar = variant === "avatar";
    const label = (name || alt || "").trim();
    const hasHeight = FIXED_HEIGHT.test(className) || !!style?.height || !!style?.aspectRatio;
    // Cùng className với ảnh gốc nên khối dự phòng giữ đúng khung; ảnh không có
    // khung cố định thì có chiều cao tối thiểu để vẫn thấy được.
    return (
      <span
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={`inline-flex items-center justify-center overflow-hidden align-middle ${hasHeight ? "" : "min-h-32"} ${className} ${
          isAvatar ? "text-xs font-semibold text-white" : "bg-stone-100 text-stone-400"
        }`}
        style={{ ...style, ...(isAvatar ? { backgroundColor: avatarColor(label || "?") } : {}) }}
      >
        {isAvatar ? label.charAt(0).toLocaleUpperCase("vi") || "?" : <ImageOff className="w-1/3 h-1/3 max-w-8 max-h-8" aria-hidden="true" />}
      </span>
    );
  }

  // Ảnh tải bình thường: <img> y như cũ; lúc đang tải chỉ thêm nền nhạt, không đổi kích thước.
  const loadingBg = state === "loading" && !/(?:^|\s)bg-/.test(className) ? " bg-stone-100" : "";
  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      className={`${className}${loadingBg}`}
      style={style}
      onLoad={e => { setState("loaded"); onLoad?.(e); }}
      onError={e => { setState("error"); onError?.(e); }}
    />
  );
}
