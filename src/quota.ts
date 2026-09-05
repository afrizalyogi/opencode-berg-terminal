import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export interface QuotaInfo {
  provider: string
  model: string
  remainingFraction: number
  resetTime?: string
  account?: string
}

export async function fetchQuotas(): Promise<QuotaInfo[]> {
  const quotas: QuotaInfo[] = []
  
  try {
    const antigravityPath = join(homedir(), ".config", "opencode", "antigravity-accounts.json")
    const content = await readFile(antigravityPath, "utf8")
    const data = JSON.parse(content)
    
    if (Array.isArray(data.accounts)) {
      for (const account of data.accounts) {
        if (account.cachedQuota) {
          for (const [model, quota] of Object.entries(account.cachedQuota)) {
            quotas.push({
              provider: "Google Cloud",
              model: model,
              remainingFraction: (quota as any).remainingFraction ?? 0,
              resetTime: (quota as any).resetTime,
              account: account.email
            })
          }
        }
      }
    }
  } catch (e) {
    // Ignore if file doesn't exist
  }

  return quotas
}
