import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { SyncIcon } from "@primer/octicons-react";
import { Link } from "../link/link";
import "./auto-update-header.scss";
import type { AppUpdaterEvent } from "@types";

const upstreamReleasesPageUrl =
  "https://github.com/hydralauncher/hydra/releases/latest";

// Fork builds set RENDERER_VITE_UPDATE_FEED_OWNER/REPO so the download link
// points at the fork's releases; unset builds fall back to the upstream URL.
const forkFeedOwner = import.meta.env.RENDERER_VITE_UPDATE_FEED_OWNER;
const forkFeedRepo = import.meta.env.RENDERER_VITE_UPDATE_FEED_REPO;

export const releasesPageUrl =
  forkFeedOwner && forkFeedRepo
    ? `https://github.com/${forkFeedOwner}/${forkFeedRepo}/releases/latest`
    : upstreamReleasesPageUrl;

export function AutoUpdateSubHeader() {
  const [isReadyToInstall, setIsReadyToInstall] = useState(false);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [isAutoInstallAvailable, setIsAutoInstallAvailable] = useState(false);

  const { t } = useTranslation("header");

  const handleClickInstallUpdate = () => {
    window.electron.restartAndInstallUpdate();
  };

  useEffect(() => {
    const unsubscribe = window.electron.onAutoUpdaterEvent(
      (event: AppUpdaterEvent) => {
        if (event.type == "update-available") {
          setNewVersion(event.info.version);
        }

        if (event.type == "update-downloaded") {
          setIsReadyToInstall(true);
        }
      }
    );

    window.electron.checkForUpdates().then((isAutoInstallAvailable) => {
      setIsAutoInstallAvailable(isAutoInstallAvailable);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  if (!newVersion) return null;

  if (!isAutoInstallAvailable) {
    return (
      <header className="auto-update-sub-header">
        <Link
          to={releasesPageUrl}
          className="auto-update-sub-header__new-version-link"
        >
          <SyncIcon
            className="auto-update-sub-header__new-version-icon"
            size={12}
          />
          {t("version_available_download", { version: newVersion })}
        </Link>
      </header>
    );
  }

  if (isReadyToInstall) {
    return (
      <header className="auto-update-sub-header">
        <button
          type="button"
          className="auto-update-sub-header__new-version-button"
          onClick={handleClickInstallUpdate}
        >
          <SyncIcon
            className="auto-update-sub-header__new-version-icon"
            size={12}
          />
          {t("version_available_install", { version: newVersion })}
        </button>
      </header>
    );
  }

  return null;
}
