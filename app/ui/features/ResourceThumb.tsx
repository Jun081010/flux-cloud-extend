import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Icon } from "@/ui/components/Icon";
import { thumbnailableUrl } from "@/utils/thumb-url";

interface Props {
  url: string;
  name: string;
  onOpen?: () => void;
}

export function ResourceThumb({ url, name, onOpen }: Props): JSX.Element {
  const src = thumbnailableUrl(url);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const fallback = (
    <span class="fd-thumb fd-thumb-fallback">
      <Icon resourceType="image" size={18} />
    </span>
  );
  if (!src || failed) {
    return onOpen ? (
      <button type="button" class="fd-thumb-btn" title={name} aria-label={name} onClick={onOpen}>
        {fallback}
      </button>
    ) : (
      <span class="fd-thumb-btn">{fallback}</span>
    );
  }
  const img = (
    <img
      class="fd-thumb"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
  return onOpen ? (
    <button type="button" class="fd-thumb-btn" title={name} aria-label={name} onClick={onOpen}>
      {img}
    </button>
  ) : (
    <span class="fd-thumb-btn">{img}</span>
  );
}
