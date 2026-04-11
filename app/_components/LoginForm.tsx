'use client'

import { useState, useTransition } from 'react'
import { loginOrRegister } from '@/app/actions/draft'
import { useRouter } from 'next/navigation'

export default function LoginForm() {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await loginOrRegister(name)
      if (result?.error) {
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      <input
        type="text"
        placeholder="Your display name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        required
        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-green-500"
      />
      <button
        type="submit"
        disabled={isPending || !name.trim()}
        className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
      >
        {isPending ? 'Joining...' : 'Join'}
      </button>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </form>
  )
}
