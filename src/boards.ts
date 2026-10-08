import { z } from "zod";

/** Job boards the user can sign in to in JobBot's browser. LinkedIn is deliberately absent (aggressive automation bans). */
export const LoginBoardSchema = z.enum(["dice", "indeed", "ziprecruiter", "monster"]);
export type LoginBoard = z.infer<typeof LoginBoardSchema>;

export const BOARDS: Record<LoginBoard, { name: string; loginUrl: string; accountUrl: string }> = {
  dice: { name: "Dice", loginUrl: "https://www.dice.com/dashboard/login", accountUrl: "https://www.dice.com/dashboard" },
  indeed: { name: "Indeed", loginUrl: "https://secure.indeed.com/auth", accountUrl: "https://profile.indeed.com/" },
  ziprecruiter: {
    name: "ZipRecruiter",
    loginUrl: "https://www.ziprecruiter.com/authn/login",
    accountUrl: "https://www.ziprecruiter.com/candidate/",
  },
  monster: { name: "Monster", loginUrl: "https://www.monster.com/", accountUrl: "https://www.monster.com/profile/detail" },
};

/** Heuristic: an account page that bounces to a login/auth URL means the session is gone. */
export const looksSignedOut = (finalUrl: string) => /log-?in|sign-?in|\/auth\b|\/authn\//i.test(finalUrl);
