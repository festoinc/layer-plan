import type { ProjectColor } from "./domain/projects";

export interface InitialCriterion {
  id: string;
  text: string;
  checked?: boolean;
}

export interface InitialChapter {
  id: string;
  title: string;
  description: string;
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
}

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
  },
];
