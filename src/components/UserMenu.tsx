import { LogOut, UserRound, UsersRound } from "lucide-react";
import { useRoute, ROUTE_VIEWS } from "../hooks/useRoute";
import { useAuth } from "../store/AuthProvider";

export function UserMenu() {
  const { user, signOut } = useAuth();
  const route = useRoute();
  if (!user) return null;

  async function handleSignOut() {
    await signOut();
    route.navigate({ view: ROUTE_VIEWS.signIn });
  }

  return (
    <details className="user-menu">
      <summary title={user.email}>
        <UserRound size={16} />
        <span>{user.displayName}</span>
      </summary>
      <div className="user-menu-panel">
        <div className="user-menu-identity">
          <strong>{user.displayName}</strong>
          <span>{user.email}</span>
        </div>
        <a href="#/account">
          <UserRound size={15} />
          Account
        </a>
        {user.role === "super_admin" && (
          <a href="#/users">
            <UsersRound size={15} />
            Users
          </a>
        )}
        <button type="button" onClick={() => void handleSignOut()}>
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </details>
  );
}
