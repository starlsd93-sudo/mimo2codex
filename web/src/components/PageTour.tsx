import { useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { FloatButton, Tour, type TourProps } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";

// Slim spec the caller writes. We resolve refs to the actual DOM node at the
// moment Tour opens (lazy getter), so steps targeting elements that mount
// after the first render still work.
export interface TourStepSpec {
  // Ref the page passes (created via useRef). null target → centered step
  // with no element highlight, useful for an intro / outro slide.
  target?: RefObject<HTMLElement>;
  title: string;
  description: React.ReactNode;
  placement?: TourProps["steps"] extends Array<infer S>
    ? S extends { placement?: infer P }
      ? P
      : never
    : never;
}

interface Props {
  // Stable id used as the localStorage key, so a returning user is not
  // re-onboarded every page reload. Pick something short + page-unique.
  pageKey: string;
  steps: TourStepSpec[];
}

// Map our slim spec to Ant Tour's full TourProps["steps"] shape. Done at
// render time (not memoized) because the input is already tiny and Tour
// itself memoizes internally.
function toTourSteps(specs: TourStepSpec[]): TourProps["steps"] {
  return specs.map((s) => ({
    title: s.title,
    description: s.description,
    placement: s.placement,
    target: s.target ? () => s.target!.current ?? document.body : undefined,
  }));
}

export function PageTour({ pageKey, steps }: Props) {
  const { t } = useTranslation("tour");
  const [open, setOpen] = useState(false);
  const storageKey = `m2c.tour.${pageKey}.done`;

  // First-time auto-open: defer one frame so the page has actually painted
  // and tour anchor elements exist in the DOM (otherwise the first step
  // jumps from screen center to the real target when the ref resolves).
  useEffect(() => {
    let cancelled = false;
    try {
      if (localStorage.getItem(storageKey) === "1") return;
    } catch {
      // Private mode / quota: silently skip auto-open. Helper button still works.
      return;
    }
    const tid = window.setTimeout(() => {
      if (!cancelled) setOpen(true);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(tid);
    };
  }, [storageKey]);

  function markDone() {
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      /* ignore */
    }
  }

  function onClose() {
    setOpen(false);
    markDone();
  }

  function onFinish() {
    setOpen(false);
    markDone();
  }

  return (
    <>
      <FloatButton
        icon={<QuestionCircleOutlined />}
        tooltip={t("openHelper")}
        type="default"
        // Position just under the fixed app header (44px tall). Using `top`
        // rather than `bottom` so the helper sits in the page's top-right
        // corner per the user's spec.
        style={{ right: 24, top: 60 }}
        onClick={() => setOpen(true)}
      />
      <Tour
        open={open}
        onClose={onClose}
        onFinish={onFinish}
        steps={toTourSteps(steps)}
      />
    </>
  );
}
