export interface DeriveRequest {
  id: string
  kxBytes: number[]
  word1: string
  word2: string
}

export interface DeriveResponse {
  id: string
  address?: string
  error?: string
}
