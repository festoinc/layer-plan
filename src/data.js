/**
 * @param {string} id
 * @param {string} text
 * @param {boolean} [checked]
 */
const criterion = (id, text, checked = false) => ({ id, text, checked });

export const initialChapters = [
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
