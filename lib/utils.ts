export interface Transaction {
  id?: string
  user_id?: string
  date: string
  details: string
  amount: number
  type: 'Debit' | 'Credit'
  status: string
  category: string
}

export function categorize(merchant: string): string {
  const m = merchant.toLowerCase()
  if (/deliveroo|talabat|careem food|kitopi|one life|onelife|gazebo|bougee|bosnian|orfali|raju|roxy|tribes|kfc|peets|joe and the juice|hadoota|boon coffee|mdd hotel|barnyard|falcone|home bakery|eln london/.test(m)) return 'Food & Dining'
  if (/careem ride|careem hala|cars taxi|careem tip/.test(m)) return 'Transport'
  if (/amazon grocery|amazon now|waitrose|noon minutes|emarat/.test(m)) return 'Groceries'
  if (/amazon\.ae|amazon dsv|noon\.com|namshi|adidas|db186 adidas|lefties|temu|retail purchase|flowers|bateel|mamo/.test(m)) return 'Shopping'
  if (/netflix|apple\.com|spotify|google\*youtube|audible|playstation|fifaus|vox cinemas/.test(m)) return 'Entertainment'
  if (/adobe|google one|google workspace|openai|chatgpt|virgin mobile|du no|smart dubai/.test(m)) return 'Tech & Subscriptions'
  if (/dewa|dubai electricity/.test(m)) return 'Utilities'
  if (/mayfair clinic|city champions/.test(m)) return 'Health & Fitness'
  if (/abroshka|department of culture|joga bonito/.test(m)) return 'Lifestyle'
  return 'Other'
}

export const CAT_COLORS: Record<string, string> = {
  'Food & Dining': '#ff6b6b',
  'Entertainment': '#a78bfa',
  'Tech & Subscriptions': '#60a5fa',
  'Shopping': '#fbbf24',
  'Transport': '#34d399',
  'Health & Fitness': '#f472b6',
  'Groceries': '#fb923c',
  'Utilities': '#94a3b8',
  'Lifestyle': '#e879f9',
  'Other': '#6b7280',
  'Income': '#00e5a0',
}

export const CAT_ICONS: Record<string, string> = {
  'Food & Dining': '🍽️',
  'Entertainment': '🎮',
  'Tech & Subscriptions': '💻',
  'Shopping': '🛍️',
  'Transport': '🚖',
  'Health & Fitness': '💊',
  'Groceries': '🛒',
  'Utilities': '⚡',
  'Lifestyle': '✨',
  'Other': '📦',
  'Income': '💳',
}

export function fmtMonth(ym: string): string {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const m = parseInt(ym.split('-')[1]) - 1
  return months[m]
}

export function fmtDate(d: string): string {
  const [y, m, day] = d.split('-')
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  return `${months[parseInt(m)-1]} ${parseInt(day)}, ${y}`
}
