import Link from 'next/link'
import { APP_NAME } from '@/lib/config'

interface LogoProps {
  className?: string
  href?: string
}

export default function Logo({ className = '', href = '/' }: LogoProps) {
  return (
    <Link href={href} className={`brand-logo ${className}`}>
      {APP_NAME}
    </Link>
  )
}

