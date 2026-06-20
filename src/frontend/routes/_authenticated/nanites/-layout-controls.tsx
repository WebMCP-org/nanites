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
  showFiles = true,
}: {
  readonly activePanel: NaniteDesktopPanel;
  readonly onToggle: (panel: Exclude<NaniteDesktopPanel, null>) => void;
  readonly showFiles?: boolean;
}) {
  return (
    <div className="nanites-workspace__panel-toggle">
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
      {showFiles ? (
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
      ) : null}
    </div>
  );
}
