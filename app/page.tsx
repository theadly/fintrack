import { createClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import DashboardClient from '@/components/DashboardClient'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: transactions }, { data: budgets }] = await Promise.all([
    supabase.from('transactions').select('*').eq('user_id', user!.id).order('date', { ascending: false }),
    supabase.from('budget_targets').select('category, monthly_target').eq('user_id', user!.id),
  ])

  const budgetMap = (budgets || []).reduce((acc: Record<string, number>, b: { category: string; monthly_target: number }) => {
    acc[b.category] = b.monthly_target
    return acc
  }, {})

  return (
    <DashboardClient
      initialTransactions={transactions || []}
      initialBudgets={budgetMap}
      userEmail={user!.email || ''}
    />
  )
}
