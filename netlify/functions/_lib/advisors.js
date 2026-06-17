/* Advisors and the branches each one covers. A branch may be covered by more
 * than one advisor, and an advisor may cover any number of branches.
 * Keep ADVISORS in sync with the list in app.js (front end). */
const ADVISORS = ["Brian Daly", "Joe Pillot", "Anthony Piccolino", "Jason Netrosio"];

const ADVISOR_BRANCHES = {
  "Brian Daly": ["South Rd", "Mid Hudson", "Arlington"],
  "Joe Pillot": ["Kingston", "East Fishkill", "Fishkill"],
  "Anthony Piccolino": ["Hyde Park", "Red Hook", "Rhinebeck"],
  "Jason Netrosio": ["Goshen", "Warwick", "Newburgh", "Fishkill"],
};

// Branches a user may see/manage. null = all (admin).
function allowedBranches(account) {
  if (!account) return [];
  if (account.role === "admin") return null;
  if (account.role === "advisor") return ADVISOR_BRANCHES[account.advisor] || [];
  return account.branch ? [account.branch] : [];
}

module.exports = { ADVISORS, ADVISOR_BRANCHES, allowedBranches };
