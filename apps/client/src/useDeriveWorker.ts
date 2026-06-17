import { useRef, useCallback } from 'react'
import type { DeriveRequest, DeriveResponse } from './derive.worker.types.js'

type Callback = (response: DeriveResponse) => void

export function useDeriveWorker() {
  const workerRef = useRef<Worker | null>(null)
  const callbacksRef = useRef<Map<string, Callback>>(new Map())

  function getWorker(): Worker {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('./derive.worker.ts', import.meta.url),
        { type: 'classic' }
      )
      workerRef.current.onmessage = (e: MessageEvent<DeriveResponse>) => {
        const cb = callbacksRef.current.get(e.data.id)
        if (cb) {
          callbacksRef.current.delete(e.data.id)
          cb(e.data)
        }
      }
    }
    return workerRef.current
  }

  const derive = useCallback(
    (req: DeriveRequest): Promise<DeriveResponse> => {
      return new Promise((resolve) => {
        callbacksRef.current.set(req.id, resolve)
        getWorker().postMessage(req)
      })
    },
    []
  )

  return { derive }
}
