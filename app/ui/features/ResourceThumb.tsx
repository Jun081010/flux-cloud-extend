import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import { Icon } from "@/ui/components/Icon";
import { thumbnailableUrl } from "@/utils/thumb-url";

interface Props {
  url: string;
  name: string;
  onOpen?: () => void;
}

function ThumbnailImage({ src }: { src: string | null }): JSX.Element {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span class="fd-thumb fd-thumb-fallback">
        <Icon resourceType="image" size={18} />
      </span>
    );
  }
  return (
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
}

export function ResourceThumb({ url, name, onOpen }: Props): JSX.Element {
  const src = useMemo(() => thumbnailableUrl(url), [url]);
  const image = <ThumbnailImage key={src} src={src} />;
  return onOpen ? (
    <button type="button" class="fd-thumb-btn" title={name} aria-label={name} onClick={onOpen}>
      {image}
    </button>
  ) : (
    <span class="fd-thumb-btn">{image}</span>
  );
}
