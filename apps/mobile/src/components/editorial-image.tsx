import { Image, type ImageSourcePropType } from "react-native";
import { useEffect, useMemo, useState } from "react";
import type { StyleProp, ImageStyle } from "react-native";
import type { ReadingDocument } from "@/types";

const cityCover = require("../../assets/editorial/city-architecture-cover.png");
const natureCover = require("../../assets/editorial/nature-environment-cover.png");
const readingCover = require("../../assets/editorial/reading-study-cover.png");

export function fallbackCoverFor(document?: Pick<ReadingDocument, "category" | "sourceType" | "title">): ImageSourcePropType {
  const signal = `${document?.category ?? ""} ${document?.sourceType ?? ""} ${document?.title ?? ""}`.toLowerCase();
  if (/city|cities|architecture|building|energy|solar|urban/.test(signal)) return cityCover;
  if (/environment|climate|nature|health|science|rain|forest/.test(signal)) return natureCover;
  if (/politic|business|government|econom|technology/.test(signal)) return cityCover;
  return readingCover;
}

export function EditorialImage({
  document,
  source,
  style,
  accessibilityLabel
}: {
  document?: Pick<ReadingDocument, "category" | "sourceType" | "title" | "coverImageUrl" | "thumbnailUrl">;
  source?: ImageSourcePropType;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
}) {
  const remoteSource = useMemo<ImageSourcePropType | undefined>(() => {
    if (source) return source;
    const uri = document?.coverImageUrl ?? document?.thumbnailUrl;
    return uri ? { uri } : undefined;
  }, [document?.coverImageUrl, document?.thumbnailUrl, source]);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [remoteSource]);

  return (
    <Image
      source={failed || !remoteSource ? fallbackCoverFor(document) : remoteSource}
      resizeMode="cover"
      accessibilityLabel={accessibilityLabel ?? (document ? `Cover image for ${document.title}` : "Editorial cover image")}
      onError={() => setFailed(true)}
      style={style}
    />
  );
}
