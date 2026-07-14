import { TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Lock } from "lucide-react";
import { interviewPrepLock } from "@/lib/interviewPrep/gate";

/**
 * The Interview Prep tab trigger. Always rendered (visible link), but inactive
 * until the application has a generated resume — surfaced with a tooltip that
 * states the prerequisite. Wrapping the disabled trigger in a focusable span
 * keeps the tooltip reachable by hover and keyboard even though the underlying
 * button is disabled, and the span's aria-label gives screen-reader users the
 * reason.
 */
export function InterviewPrepTabTrigger({
  app,
}: {
  app: { resume_html: string | null };
}) {
  const { locked, reason } = interviewPrepLock(app);

  if (!locked) {
    return <TabsTrigger value="interview-prep">Interview Prep</TabsTrigger>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex"
          tabIndex={0}
          role="button"
          aria-disabled="true"
          aria-label={reason ?? undefined}
          title={reason ?? undefined}
        >
          <TabsTrigger
            value="interview-prep"
            disabled
            className="pointer-events-none flex items-center gap-1.5 text-muted-foreground"
          >
            <Lock className="h-3 w-3" />
            Interview Prep
          </TabsTrigger>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {reason}
      </TooltipContent>
    </Tooltip>
  );
}
