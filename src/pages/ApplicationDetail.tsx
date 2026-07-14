import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Loader2, ChevronLeft, ChevronRight as ChevronRightIcon, User, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApplicationDetail } from "@/hooks/useApplicationDetail";
import { useCoverLetterEditor } from "@/hooks/useCoverLetterEditor";
import { useDashboardEditor } from "@/hooks/useDashboardEditor";
import { useResumeEditor } from "@/hooks/useResumeEditor";
import { ResumeTab } from "@/components/tabs/ResumeTab";
import { CoverLetterTab } from "@/components/tabs/CoverLetterTab";
import { JDAnalysisTab } from "@/components/tabs/JDAnalysisTab";
import { DetailsTab } from "@/components/tabs/DetailsTab";
import { InterviewPrepTab } from "@/components/tabs/InterviewPrepTab";
import { InterviewPrepTabTrigger } from "@/components/tabs/InterviewPrepTabTrigger";
import DynamicMaterialsSection from "@/components/DynamicMaterialsSection";
import { PageShell } from "@/components/PageShell";

/** Valid tab slugs — must match the route segment and the Tabs value prop. */
const VALID_TABS = ["resume", "cover-letter", "jd-analysis", "materials", "details", "interview-prep"] as const;
type TabSlug = typeof VALID_TABS[number];

/**
 * Convert generated resume HTML into the plain text stored in
 * `profiles.resume_text` — mirroring the text that resume-upload extraction
 * produces, so a generated resume can populate the profile the same way an
 * uploaded one does.
 */
function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  doc
    .querySelectorAll("p, div, li, h1, h2, h3, h4, h5, tr")
    .forEach((el) => el.append("\n"));
  const text = doc.body.textContent || "";
  return text
    .replace(/^[ \t]+/gm, "")   // strip source-HTML indentation per line
    .replace(/[ \t]+$/gm, "")   // strip trailing whitespace per line
    .replace(/\n{3,}/g, "\n\n") // collapse runs of blank lines
    .trim();
}

/**
 * Pull the candidate's name from the generated resume header (the leading
 * <h1>, falling back to the first text line) and split it into first / last.
 */
function extractCandidateName(html: string): {
  firstName: string | null;
  lastName: string | null;
} {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let name = (doc.querySelector("h1")?.textContent || "").trim();
  if (!name) {
    const lines = (doc.body.textContent || "")
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    name = lines[0] || "";
  }
  const parts = name.split(/\s+/).filter(Boolean);
  // Guard against placeholders ("[Candidate Name]") or section text.
  if (!name || /[[\]]/.test(name) || parts.length === 0 || parts.length > 5) {
    return { firstName: null, lastName: null };
  }
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

/**
 * Derive a Key Skills list from the resume's Skills section — the bullet
 * items under the first heading matching "Skills", with a comma-separated
 * fallback for resumes that render skills as inline text.
 */
function extractSkillsFromHtml(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const headings = [...doc.querySelectorAll("h1,h2,h3")];
  const idx = headings.findIndex((h) => /\bskills\b/i.test(h.textContent || ""));
  if (idx === -1) return [];

  const start = headings[idx];
  const next = headings[idx + 1] || null;
  const inRegion = (el: Element) => {
    const afterStart = !!(
      start.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    const beforeNext =
      !next ||
      !!(next.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
    return afterStart && beforeNext;
  };

  let skills = [...doc.querySelectorAll("li")]
    .filter(inRegion)
    .map((li) => (li.textContent || "").trim())
    .filter(Boolean);

  if (skills.length === 0) {
    const regionText = [...doc.querySelectorAll("p,div,span")]
      .filter(inRegion)
      .map((el) => el.textContent || "")
      .join(", ");
    skills = regionText
      .split(/[,••\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 40);
  }

  return Array.from(new Set(skills)).slice(0, 30);
}

const ApplicationDetail = () => {
  const detail = useApplicationDetail();
  const { tab: tabParam } = useParams<{ id: string; tab?: string }>();
  const activeTab: TabSlug = (VALID_TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as TabSlug)
    : "resume";

  const {
    id, navigate, toast, app, setApp, loading, saving, isValidUuid,
    coverLetter, setCoverLetter, editingCoverLetter, setEditingCoverLetter,
    jobDescription, setJobDescription, editingJobDescription, setEditingJobDescription,
    companyUrl, setCompanyUrl, jobUrl, setJobUrl, companyName, setCompanyName, jobTitle, setJobTitle,
    editingMeta, setEditingMeta,
    dashboardHtml, setDashboardHtml, dashboardData, setDashboardData,
    chatHistory, setChatHistory,
    revisionTrigger, setRevisionTrigger,
    coverLetterRevisionTrigger, setCoverLetterRevisionTrigger,
    resumeRevisionTrigger, setResumeRevisionTrigger,
    previewHtml, setPreviewHtml, previewCoverLetter, setPreviewCoverLetter,
    previewResumeHtml, setPreviewResumeHtml,
    bgJob, isBgGenerating, prevId, nextId,
    resumeText, userProfile, userResumes,
    saveField, handleCopy, handleAcceptFabrication, handleRevertFabrication,
  } = detail;

  // Profile-completeness nudge: shown once a resume is generated but the user's
  // profile still has no resume text. "Go to Profile" incorporates this resume
  // into the profile (same end state as an uploaded resume) before navigating.
  const [profileBannerDismissed, setProfileBannerDismissed] = useState(false);
  const [addingToProfile, setAddingToProfile] = useState(false);
  const queryClient = useQueryClient();

  const clEditor = useCoverLetterEditor({
    id, coverLetter, setCoverLetter,
    coverLetterRevisionTrigger, setCoverLetterRevisionTrigger,
    userProfile, jobDescription, saveField, toast,
  });

  const dashEditor = useDashboardEditor({
    id, app, jobDescription, companyName, jobTitle,
    dashboardHtml, setDashboardHtml, dashboardData, setDashboardData,
    chatHistory, setChatHistory, revisionTrigger, setRevisionTrigger,
    saveField, toast,
  });

  const resumeEditor = useResumeEditor({
    id, app, setApp, jobDescription, companyName, jobTitle,
    userResumes, resumeRevisionTrigger, setResumeRevisionTrigger, toast,
  });

  // Profile incomplete = no resume text on the profile (same gate as the
  // Applications list nudge). Show only once a resume has actually generated.
  const showProfileNudge =
    !!app?.resume_html && !resumeText && !profileBannerDismissed;

  const handleAddResumeToProfile = async () => {
    if (!app?.resume_html) return;
    setAddingToProfile(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: "Please sign in to update your profile.", variant: "destructive" });
        return;
      }
      const plainText = htmlToPlainText(app.resume_html);
      const { firstName, lastName } = extractCandidateName(app.resume_html);
      const derivedSkills = extractSkillsFromHtml(app.resume_html);

      // Populate the profile the same way an uploaded resume would: resume text,
      // the candidate's name, and Key Skills derived from the resume.
      const updates: Record<string, unknown> = { resume_text: plainText };
      if (firstName) updates.first_name = firstName;
      if (lastName) updates.last_name = lastName;
      if (derivedSkills.length > 0) updates.key_skills = derivedSkills;

      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", user.id);
      if (error) throw error;
      // Ensure the Profile page reads the freshly written values rather than a
      // stale cached profile (it locks form state in on first load).
      await queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
      navigate("/profile");
    } catch (e: any) {
      toast({
        title: "Couldn't add this resume to your profile.",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setAddingToProfile(false);
    }
  };

  if (loading) {
    return (
      <PageShell showSecondSkyscraper>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  if (!app || !isValidUuid) {
    return (
      <PageShell showSecondSkyscraper>
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <p className="text-muted-foreground">Application not found.</p>
          <Button variant="outline" onClick={() => navigate("/applications")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell showSecondSkyscraper>
      <div className="px-4 md:px-8 pt-2.5 pb-4 md:pt-5 md:pb-8 space-y-6">
        {/* Profile completeness nudge — incorporate this resume into the profile */}
        {showProfileNudge && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
            <User className="h-5 w-5 text-primary flex-shrink-0" />
            <div className="flex-1 text-sm">
              Use this resume to complete your profile, to make searching for additional positions easier in the future.
            </div>
            <Button variant="outline" size="sm" disabled={addingToProfile} onClick={handleAddResumeToProfile}>
              {addingToProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : "Go to Profile"}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setProfileBannerDismissed(true)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-baseline gap-3 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => navigate("/applications")} className="shrink-0 h-auto px-2 py-1 text-xs font-normal text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3 mr-1" /> Back
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight truncate">
                {companyName || "Unknown Company"} — {jobTitle || "Unknown Role"}
              </h1>
              {app.job_url && (
                <p className="text-xs text-muted-foreground truncate">
                  <a href={app.job_url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
                    {app.job_url}
                  </a>
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0" data-tour="prev-next">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={!prevId}
              onClick={() => prevId && navigate(`/applications/${prevId}`)} title="Previous application">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={!nextId}
              onClick={() => nextId && navigate(`/applications/${nextId}`)} title="Next application">
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            {app.status !== "complete" && (
              <Badge variant="secondary">{app.status}</Badge>
            )}
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(val) => {
            // No cover letter yet → launch the guided cover letter creation flow.
            if (val === "cover-letter" && !app.cover_letter && !isBgGenerating) {
              navigate(`/build-my-cover-letter?app=${id}`);
              return;
            }
            navigate(`/applications/${id}/${val}`);
          }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <TabsList className="justify-start flex-wrap">
              <TabsTrigger value="resume">Resume</TabsTrigger>
              {/* Cover Letter tab is always present. When no cover letter exists
                  yet, selecting it opens the guided creation flow (handled above). */}
              <TabsTrigger value="cover-letter" className="flex items-center gap-1.5">
                Cover Letter
                {app?.generation_status && !["idle", "complete", "error"].includes(app.generation_status) && !app?.cover_letter && (
                  <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
                )}
              </TabsTrigger>
              {(!!app.jd_intelligence || isBgGenerating) && (
                <TabsTrigger value="jd-analysis">JD Analysis</TabsTrigger>
              )}
              {(!!app.dashboard_html || !!app.executive_report_html || !!app.architecture_diagram_html || !!app.raid_log_html || !!app.roadmap_html || isBgGenerating) && (
                <TabsTrigger value="materials" className="flex items-center gap-1.5">
                  Materials
                  {isBgGenerating && bgJob && ["generating-materials", "dashboard", "cover-letter", "resume-complete"].includes(bgJob.status) && (
                    <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
                  )}
                </TabsTrigger>
              )}
              <TabsTrigger value="details">Details</TabsTrigger>
              {/* Interview Prep: always visible, inactive until a resume exists
                  (guarantees JD + tailored resume for question grounding). */}
              <InterviewPrepTabTrigger app={app} />
            </TabsList>
            <div id="resume-tab-actions" className="flex items-center gap-2" />
          </div>

          <TabsContent value="resume" className="space-y-4">
            <ResumeTab
              id={id!} app={app} userProfile={userProfile} setApp={setApp}
              jobDescription={jobDescription} companyName={companyName} jobTitle={jobTitle}
              resumeText={resumeText} userResumes={userResumes}
              isBgGenerating={isBgGenerating} bgJob={bgJob}
              previewResumeHtml={previewResumeHtml} setPreviewResumeHtml={setPreviewResumeHtml}
              resumeRevisionTrigger={resumeRevisionTrigger} setResumeRevisionTrigger={setResumeRevisionTrigger}
              {...resumeEditor}
              saveField={saveField}
              handleAcceptFabrication={handleAcceptFabrication}
              handleRevertFabrication={handleRevertFabrication}
              toast={toast}
            />
          </TabsContent>

          <TabsContent value="cover-letter">
            <CoverLetterTab
              id={id!} app={app}
              coverLetter={coverLetter} setCoverLetter={setCoverLetter}
              editingCoverLetter={editingCoverLetter} setEditingCoverLetter={setEditingCoverLetter}
              saving={saving} companyName={companyName} jobTitle={jobTitle}
              userProfile={userProfile}
              previewCoverLetter={previewCoverLetter} setPreviewCoverLetter={setPreviewCoverLetter}
              coverLetterRevisionTrigger={coverLetterRevisionTrigger}
              {...clEditor}
              saveField={saveField} handleCopy={handleCopy} toast={toast}
            />
          </TabsContent>

          <TabsContent value="jd-analysis" className="space-y-4">
            <JDAnalysisTab
              id={id!} app={app} setApp={setApp}
              jobDescription={jobDescription} setJobDescription={setJobDescription}
              editingJobDescription={editingJobDescription} setEditingJobDescription={setEditingJobDescription}
               companyUrl={companyUrl} setCompanyUrl={setCompanyUrl}
               companyName={companyName} jobTitle={jobTitle}
               resumeText={resumeText} saving={saving}
               saveField={saveField} handleCopy={handleCopy} toast={toast}
               jobUrl={jobUrl} setJobUrl={setJobUrl}
            />
          </TabsContent>

          <TabsContent value="materials" className="space-y-4">
            <DynamicMaterialsSection
              applicationId={id!} app={app}
              jobDescription={jobDescription} companyName={companyName} jobTitle={jobTitle}
              isBgGenerating={isBgGenerating} bgJob={bgJob}
              dashboardHtml={dashboardHtml} dashboardData={dashboardData}
              setDashboardHtml={setDashboardHtml} setDashboardData={setDashboardData}
              chatOpen={dashEditor.chatOpen} setChatOpen={dashEditor.setChatOpen}
              chatInput={dashEditor.chatInput} setChatInput={dashEditor.setChatInput}
              chatHistory={chatHistory} setChatHistory={setChatHistory}
              isRefining={dashEditor.isRefining} setIsRefining={dashEditor.setIsRefining}
              isRegenerating={dashEditor.isRegenerating} setIsRegenerating={dashEditor.setIsRegenerating}
              previewHtml={previewHtml} setPreviewHtml={setPreviewHtml}
              revisionTrigger={revisionTrigger} setRevisionTrigger={setRevisionTrigger}
              iframeRef={dashEditor.iframeRef}
              handleRegenerateDashboard={dashEditor.handleRegenerateDashboard}
              handleSendChat={dashEditor.handleSendChat}
              handleDownloadZip={dashEditor.handleDownloadZip}
              saveField={saveField} toast={toast}
            />
          </TabsContent>

          <TabsContent value="details" className="space-y-4">
            <DetailsTab
              app={app}
              companyName={companyName} setCompanyName={setCompanyName}
              jobTitle={jobTitle} setJobTitle={setJobTitle}
              companyUrl={companyUrl} setCompanyUrl={setCompanyUrl}
              jobDescription={jobDescription} setJobDescription={setJobDescription}
              editingMeta={editingMeta} setEditingMeta={setEditingMeta}
              saving={saving} saveField={saveField}
            />
          </TabsContent>

          <TabsContent value="interview-prep" className="space-y-4">
            <InterviewPrepTab applicationId={id!} app={app} />
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
};

export default ApplicationDetail;
