import { FileIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
import {
  Tooltip,
  TooltipPopup,
  TooltipPortal,
  TooltipPositioner,
  TooltipTrigger,
} from "#/frontend/ui/components/Tooltip.tsx";

export type NaniteDesktopPanel = "summary" | "files" | null;

export function getNextNaniteDesktopPanel(
  current: NaniteDesktopPanel,
  requested: Exclude<NaniteDesktopPanel, null>,
): NaniteDesktopPanel {
  return current === requested ? null : requested;
}

export function NaniteDesktopPanelControls({
  activePanel,
  onToggle,
}: {
  readonly activePanel: NaniteDesktopPanel;
  readonly onToggle: (panel: Exclude<NaniteDesktopPanel, null>) => void;
}) {
  return (
    <div className="nanites-workspace__panel-toggle" aria-label="Chat panels">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Summary"
              aria-pressed={activePanel === "summary"}
              data-selected={activePanel === "summary"}
              onClick={() => onToggle("summary")}
            >
              <SlidersHorizontalIcon size={14} aria-hidden="true" />
            </button>
          }
        />
        <TooltipPortal>
          <TooltipPositioner side="bottom" sideOffset={6}>
            <TooltipPopup>Summary</TooltipPopup>
          </TooltipPositioner>
        </TooltipPortal>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="File explorer"
              aria-pressed={activePanel === "files"}
              data-selected={activePanel === "files"}
              onClick={() => onToggle("files")}
            >
              <FileIcon size={14} aria-hidden="true" />
            </button>
          }
        />
        <TooltipPortal>
          <TooltipPositioner side="bottom" sideOffset={6}>
            <TooltipPopup>File explorer</TooltipPopup>
          </TooltipPositioner>
        </TooltipPortal>
      </Tooltip>
    </div>
  );
}
