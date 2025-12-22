import { MergeCommentsClient } from "./merge-comments-client"

export const dynamic = "force-static"
export const revalidate = false

export default function MergeCommentsPage() {
  return <MergeCommentsClient />
}
