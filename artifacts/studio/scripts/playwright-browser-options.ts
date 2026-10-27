/** Keep hosted QA on the runner's packaged browser without weakening its sandbox. */
export function studioBrowserOptions(
  environment: { CI?: string; GITHUB_ACTIONS?: string },
  localExecutablePath: string,
) {
  const useHostedChrome =
    environment.CI === "true" && environment.GITHUB_ACTIONS === "true";

  return {
    ...(useHostedChrome ? { channel: "chrome" as const } : {}),
    launchOptions: {
      chromiumSandbox: true,
      ...(!useHostedChrome && localExecutablePath
        ? { executablePath: localExecutablePath }
        : {}),
      args: ["--disable-dev-shm-usage"],
    },
  };
}
