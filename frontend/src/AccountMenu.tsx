import { Link } from "react-router-dom";
import { Icon } from "./Icons.js";
import { shortenAddress } from "./format.js";

type AccountMenuProps = {
  address: string;
  displayName: string | null;
  name: string;
  loading: boolean;
  error: string | null;
  saving: boolean;
  onNameChange: (value: string) => void;
  onSaveName: () => void;
  onSignOut: () => void;
};

export function AccountMenu({
  address,
  displayName,
  name,
  loading,
  error,
  saving,
  onNameChange,
  onSaveName,
  onSignOut,
}: AccountMenuProps) {
  return (
    <details className="account">
      <summary aria-label={summaryLabel(loading, error, displayName)}>
        <Icon name="user" /> {greeting(loading, error, displayName)}
      </summary>
      <div className="account-menu">
        <label htmlFor="display-name">Display name</label>
        <NameField
          name={name}
          loading={loading}
          error={error}
          onNameChange={onNameChange}
        />
        <button
          className="menu-button"
          disabled={saving || loading || Boolean(error)}
          onClick={onSaveName}
        >
          {saving ? "Saving..." : "Save"} <Icon name="check" />
        </button>
        <p className="account-address">{shortenAddress(address)}</p>
        <Link className="menu-button" to={`/creator/${address}`}>
          Your page
        </Link>
        <button className="menu-button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </details>
  );
}

function NameField({
  name,
  loading,
  error,
  onNameChange,
}: {
  name: string;
  loading: boolean;
  error: string | null;
  onNameChange: (value: string) => void;
}) {
  if (loading) return <p className="account-loading">Loading profile...</p>;
  if (error) return <p className="account-loading">{error}</p>;
  return (
    <input
      id="display-name"
      value={name}
      onChange={(event) => onNameChange(event.target.value)}
      placeholder="Add a display name"
      maxLength={40}
    />
  );
}

function greeting(loading: boolean, error: string | null, displayName: string | null) {
  if (loading) return "Checking profile...";
  if (error) return "Profile unavailable";
  return `Hi, ${displayName ?? "there"}!`;
}

function summaryLabel(
  loading: boolean,
  error: string | null,
  displayName: string | null,
) {
  if (loading) return "Your account, checking profile";
  if (error) return "Your account, profile unavailable";
  return `Your account ${displayName ?? "Add your name"}`;
}
