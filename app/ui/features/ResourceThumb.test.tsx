import { expect, mock, test } from "bun:test";
import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { ResourceThumb } from "./ResourceThumb";

test("列表缩略图可打开预览，加载失败回退，换图时恢复预览", async () => {
  const { document, Event } = parseHTML("<html><body><main></main></body></html>");
  const container = document.querySelector("main")!;
  const previousDocument = globalThis.document;
  globalThis.document = document;
  const onOpen = mock(() => {});

  try {
    act(() => render(<ResourceThumb url="https://pbs.twimg.com/media/example?name=orig" name="示例" onOpen={onOpen} />, container));
    const first = container.querySelector("img")!;
    expect(first.getAttribute("src")).toBe("https://pbs.twimg.com/media/example?name=small");
    expect(first.getAttribute("loading")).toBe("lazy");
    expect(first.getAttribute("referrerpolicy")).toBe("no-referrer");

    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("示例");
    button.dispatchEvent(new Event("click"));
    expect(onOpen).toHaveBeenCalledTimes(1);

    act(() => first.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(button.querySelector(".fd-thumb-fallback svg")).not.toBeNull();

    act(() => render(<ResourceThumb url="https://example.com/next.png" name="下一张" onOpen={onOpen} />, container));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/next.png");
  } finally {
    act(() => render(null, container));
    globalThis.document = previousDocument;
  }
});
