import type { ProjectColor } from "./domain/projects";
import type { VerificationRule } from "./domain/verification";

export interface InitialCriterion {
  id: string;
  text: string;
  checked?: boolean;
}

export interface InitialChapter {
  id: string;
  title: string;
  description: string;
  verification?: VerificationRule;
  criteria: InitialCriterion[];
  children?: InitialChapter[];
}

export interface SampleProject {
  project: {
    id: string;
    name: string;
    initials: string;
    color: ProjectColor;
    description: string;
  };
  chapters: InitialChapter[];
  selectedId: string;
  testGuidelines: string;
}

const verification = (
  mode: VerificationRule["mode"],
  content: string,
): VerificationRule => ({
  mode,
  auto: { command: mode === "auto" ? content : "" },
  human: { instructions: mode === "human" ? content : "" },
  ai: { instructions: mode === "ai" ? content : "" },
});

const criterion = (
  id: string,
  text: string,
  checked: boolean = false,
): InitialCriterion => ({ id, text, checked });

export const initialChapters: InitialChapter[] = [
  {
    id: "authentication",
    title: "Authentication",
    description:
      "Let people securely access their account and recover it when they need to.",
    criteria: [
      criterion("auth-1", "Users can log in with their login and password"),
      criterion("auth-2", "Users can reset a forgotten password"),
    ],
    children: [
      {
        id: "login",
        title: "Login form",
        description:
          "Provide a simple login form with a login field and a password field.",
        verification: verification("auto", "npm test login:test-ok"),
        criteria: [
          criterion("login-1", "Login can be entered", true),
          criterion("login-2", "Password can be entered"),
          criterion("login-3", "Login contains exactly 5 digits"),
          criterion(
            "login-4",
            "Password has 8 characters with uppercase and lowercase letters",
          ),
        ],
        children: [],
      },
      {
        id: "password-reset",
        title: "Password reset",
        description:
          "Allow users to securely reset their password by email.\n\nA user enters their email address and receives a **unique link** to choose a new password.\n\n> Reset links expire after `30 minutes`.",
        verification: verification(
          "human",
          "Request a reset with the shared test account and confirm the email arrives with one unique link.",
        ),
        criteria: [
          criterion(
            "reset-1",
            "A user can request a password reset by email",
            true,
          ),
          criterion("reset-2", "A reset email is sent with a **unique link**"),
          criterion("reset-3", "The reset link expires after `30 minutes`"),
          criterion(
            "reset-4",
            "A user can set a new password using a valid link",
          ),
        ],
        children: [
          {
            id: "email-template",
            title: "Reset email template",
            description:
              "Send a clear password reset email that explains why it was sent and gives the user one action to take.",
            verification: verification("auto", "npm test email:button"),
            criteria: [
              criterion(
                "email-1",
                "The email includes a reset password button",
              ),
              criterion(
                "email-2",
                "The email explains when the reset link expires",
              ),
              criterion(
                "email-3",
                "The email looks good on mobile and desktop",
              ),
            ],
            children: [
              {
                id: "smtp",
                title: "SMTP requirements",
                description:
                  "Use a configured SMTP service to deliver password reset emails reliably.",
                verification: verification("auto", "npm test smtp:tls"),
                criteria: [
                  criterion("smtp-1", "SMTP connections use TLS"),
                  criterion("smtp-2", "Emails use a verified sender address"),
                  criterion("smtp-3", "Failed delivery attempts are retried"),
                ],
                children: [],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "user-profiles",
    title: "User profiles",
    description: "Give users a place to manage their personal details.",
    criteria: [
      criterion("profile-1", "A user can change their display name"),
      criterion("profile-2", "A user can upload a profile photo"),
    ],
    children: [],
  },
];

export const initialMobileChapters: InitialChapter[] = [
  {
    id: "mobile-onboarding",
    title: "Onboarding",
    description:
      "Introduce the app and collect only the permissions needed for the first useful action.",
    criteria: [
      criterion("mobile-onboarding-1", "A new user can reach the home screen"),
      criterion("mobile-onboarding-2", "Skipping onboarding is possible"),
    ],
    children: [
      {
        id: "mobile-welcome",
        title: "Welcome screens",
        description:
          "Explain the core value in three short screens with a clear way to continue.",
        verification: verification("auto", "npm test mobile:welcome"),
        criteria: [
          criterion(
            "mobile-welcome-1",
            "The welcome flow has no more than three screens",
            true,
          ),
          criterion("mobile-welcome-2", "Every screen has a skip action"),
        ],
      },
      {
        id: "mobile-permissions",
        title: "Permission prompts",
        description:
          "Ask for notifications and location only when the feature needs them.",
        verification: verification(
          "ai",
          "Walk through the permission prompts and report whether the copy explains the benefit before the system dialog.",
        ),
        criteria: [
          criterion(
            "mobile-permissions-1",
            "Permission copy explains the benefit",
          ),
          criterion(
            "mobile-permissions-2",
            "A denied permission can be retried from settings",
          ),
        ],
      },
    ],
  },
  {
    id: "mobile-notifications",
    title: "Push notifications",
    description: "Deliver useful notifications without overwhelming the user.",
    criteria: [
      criterion("mobile-notifications-1", "Notifications can be muted"),
      criterion("mobile-notifications-2", "Quiet hours are respected"),
    ],
    children: [
      {
        id: "mobile-opt-in",
        title: "Opt-in flow",
        description:
          "Request the system permission after the user enables a notification category.",
        verification: verification("auto", "npm test mobile:opt-in"),
        criteria: [
          criterion(
            "mobile-opt-in-1",
            "The system prompt appears after an explicit action",
          ),
          criterion("mobile-opt-in-2", "The choice is remembered"),
        ],
      },
      {
        id: "mobile-delivery",
        title: "Delivery rules",
        description:
          "Group low-priority messages and avoid duplicate delivery across devices.",
        verification: verification("auto", "npm test mobile:delivery"),
        criteria: [
          criterion("mobile-delivery-1", "Duplicate messages are collapsed"),
          criterion("mobile-delivery-2", "Delivery failures are retried"),
        ],
      },
    ],
  },
  {
    id: "mobile-offline",
    title: "Offline mode",
    description:
      "Keep the last useful data available when the connection drops and recover cleanly.",
    criteria: [
      criterion("mobile-offline-1", "Cached data is clearly labelled"),
      criterion("mobile-offline-2", "Pending changes survive an app restart"),
    ],
    children: [
      {
        id: "mobile-cache",
        title: "Cache policy",
        description:
          "Cache the project list and recently opened chapters, with an expiry and a manual refresh.",
        verification: verification(
          "human",
          "Read the cache documentation and confirm the expiry matches the configured value.",
        ),
        criteria: [
          criterion("mobile-cache-1", "The cache has a documented expiry"),
          criterion("mobile-cache-2", "Pull to refresh bypasses the cache"),
        ],
      },
      {
        id: "mobile-sync",
        title: "Sync conflicts",
        description:
          "When local and remote edits conflict, keep both values available for review.",
        verification: verification(
          "ai",
          "Create conflicting local and remote edits and verify the review screen appears before any overwrite.",
        ),
        criteria: [
          criterion("mobile-sync-1", "Conflicts are shown before overwriting"),
          criterion("mobile-sync-2", "The user can keep the local version"),
        ],
      },
    ],
  },
];

export const sampleProjects: SampleProject[] = [
  {
    project: {
      id: "website",
      name: "Website project",
      initials: "W",
      color: "indigo",
      description: "Customer-facing website and account flows.",
    },
    chapters: initialChapters,
    selectedId: "password-reset",
    testGuidelines:
      "Run npm test before verifying the website. Use the shared test account test@example.com and never use production data. Human reviewers should record the browser and viewport. AI reviewers should report the command output, the expected result and any screenshots.",
  },
  {
    project: {
      id: "mobile",
      name: "Mobile app",
      initials: "M",
      color: "teal",
      description: "Mobile onboarding, notifications and offline behaviour.",
    },
    chapters: initialMobileChapters,
    selectedId: "mobile-onboarding",
    testGuidelines:
      "Run npm test mobile before verifying the app. Use an emulator with a clean install and a test account. Human reviewers should check both online and offline states. AI reviewers should include device size, permission state and reproduction steps in the report.",
  },
];
