import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function getS3Config() {
  const endpoint = process.env.S3_ENDPOINT
  const region = process.env.S3_REGION || process.env.AWS_REGION || 'auto'
  const accessKeyId = process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY
  const bucketName = process.env.S3_BUCKET_NAME
  // Public URL for accessing files (e.g., https://cdn.blitzrechnung.de)
  const publicUrl = process.env.S3_PUBLIC_URL

  // Provide helpful error messages
  if (!accessKeyId) {
    throw new Error(
      'S3_ACCESS_KEY or AWS_ACCESS_KEY_ID environment variable is required. ' +
      'Please add it to your .env.local file and restart the development server.'
    )
  }
  if (!secretAccessKey) {
    throw new Error(
      'S3_SECRET_KEY or AWS_SECRET_ACCESS_KEY environment variable is required. ' +
      'Please add it to your .env.local file and restart the development server.'
    )
  }
  if (!bucketName) {
    throw new Error(
      'S3_BUCKET_NAME environment variable is required. ' +
      'Please add it to your .env.local file and restart the development server.'
    )
  }

  return {
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl,
  }
}

/**
 * Builds a public URL for a given S3 key
 * Uses S3_PUBLIC_URL if configured, otherwise falls back to S3 endpoint URL
 */
function buildPublicUrl(key: string, config: ReturnType<typeof getS3Config>): string {
  // If public URL is configured (e.g., CDN), use it
  if (config.publicUrl) {
    // Remove trailing slash if present
    const baseUrl = config.publicUrl.replace(/\/$/, '')
    return `${baseUrl}/${key}`
  }
  
  // Fallback to S3 endpoint URL
  if (config.endpoint) {
    // For Cloudflare R2: endpoint + /bucket-name/key
    const endpointUrl = new URL(config.endpoint)
    return `${endpointUrl.protocol}//${endpointUrl.host}/${config.bucketName}/${key}`
  }
  
  // For AWS S3: standard format
  return `https://${config.bucketName}.s3.${config.region}.amazonaws.com/${key}`
}

export async function uploadToS3(
  userId: string,
  invoiceId: string,
  fileName: string,
  fileBuffer: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  const config = getS3Config()
  
  // Configure S3Client for Cloudflare R2 or AWS S3
  const s3ClientConfig: any = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  }

  // If custom endpoint is provided (e.g., Cloudflare R2), use it
  if (config.endpoint) {
    s3ClientConfig.endpoint = config.endpoint
    s3ClientConfig.forcePathStyle = true // Required for Cloudflare R2
  }

  const s3Client = new S3Client(s3ClientConfig)

  const key = `app/${userId}/${invoiceId}/${fileName}`
  
  const command = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  })

  await s3Client.send(command)

  // Return the public URL
  return buildPublicUrl(key, config)
}

export async function getPresignedUrl(
  fileUrl: string,
  expiresIn: number = 3600 // Default 1 hour
): Promise<string> {
  const config = getS3Config()

  // Configure S3Client
  const s3ClientConfig: any = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  }

  if (config.endpoint) {
    s3ClientConfig.endpoint = config.endpoint
    s3ClientConfig.forcePathStyle = true
  }

  const s3Client = new S3Client(s3ClientConfig)

  // Extract the key from the URL
  const key = extractKeyFromUrl(fileUrl, config.bucketName)

  const command = new GetObjectCommand({
    Bucket: config.bucketName,
    Key: key,
  })

  return getSignedUrl(s3Client, command, { expiresIn })
}

/**
 * Downloads a file from S3 and returns it as a Buffer
 */
export async function downloadFromS3(fileUrl: string): Promise<Buffer> {
  const config = getS3Config()

  // Configure S3Client
  const s3ClientConfig: any = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  }

  if (config.endpoint) {
    s3ClientConfig.endpoint = config.endpoint
    s3ClientConfig.forcePathStyle = true
  }

  const s3Client = new S3Client(s3ClientConfig)

  // Extract the key from the URL
  const key = extractKeyFromUrl(fileUrl, config.bucketName)
  console.log('[S3] Downloading file - URL:', fileUrl, 'Key:', key, 'Bucket:', config.bucketName)

  const command = new GetObjectCommand({
    Bucket: config.bucketName,
    Key: key,
  })

  try {
    const response = await s3Client.send(command)

    if (!response.Body) {
      throw new Error('No file content returned from S3')
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as any) {
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)
    console.log('[S3] Downloaded successfully, size:', buffer.length, 'bytes')
    return buffer
  } catch (err) {
    console.error('[S3] Download failed:', err)
    throw err
  }
}

/**
 * Uploads a company logo to S3
 * Logos are stored at logos/{companyId}/logo.{ext}
 */
export async function uploadLogoToS3(
  companyId: string,
  fileBuffer: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  const config = getS3Config()
  
  // Configure S3Client for Cloudflare R2 or AWS S3
  const s3ClientConfig: any = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  }

  // If custom endpoint is provided (e.g., Cloudflare R2), use it
  if (config.endpoint) {
    s3ClientConfig.endpoint = config.endpoint
    s3ClientConfig.forcePathStyle = true // Required for Cloudflare R2
  }

  const s3Client = new S3Client(s3ClientConfig)

  // Determine file extension from content type
  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  const key = `logos/${companyId}/logo.${ext}`
  
  const command = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  })

  await s3Client.send(command)

  // Return the public URL
  return buildPublicUrl(key, config)
}

/**
 * Deletes a company logo from S3
 */
export async function deleteLogoFromS3(companyId: string): Promise<void> {
  const config = getS3Config()
  
  const s3ClientConfig: any = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  }

  if (config.endpoint) {
    s3ClientConfig.endpoint = config.endpoint
    s3ClientConfig.forcePathStyle = true
  }

  const s3Client = new S3Client(s3ClientConfig)

  // Try to delete both png and jpg versions
  const extensions = ['png', 'jpg']
  
  for (const ext of extensions) {
    const key = `logos/${companyId}/logo.${ext}`
    try {
      const command = new DeleteObjectCommand({
        Bucket: config.bucketName,
        Key: key,
      })
      await s3Client.send(command)
    } catch {
      // Ignore errors - file might not exist with this extension
    }
  }
}

/**
 * Extracts the S3 key from a file URL
 * Handles both S3 endpoint URLs and public CDN URLs
 */
function extractKeyFromUrl(fileUrl: string, bucketName: string): string {
  try {
    const url = new URL(fileUrl)
    const publicUrl = process.env.S3_PUBLIC_URL
    
    // Remove leading slash and get path parts
    const pathParts = url.pathname.split('/').filter(Boolean)
    
    // If using public CDN URL, the path is the key directly (no bucket name prefix)
    if (publicUrl) {
      const publicUrlParsed = new URL(publicUrl)
      if (url.host === publicUrlParsed.host) {
        return pathParts.join('/')
      }
    }
    
    // For S3 endpoint URLs, the first part might be the bucket name
    if (pathParts[0] === bucketName) {
      return pathParts.slice(1).join('/')
    }
    
    return pathParts.join('/')
  } catch {
    // If URL parsing fails, assume it's already a key
    return fileUrl
  }
}

