# Deploying the API to Cloud Run (Mumbai)

Cloud Run runs the existing `Dockerfile` as-is — it already listens on `$PORT`
and runs as a non-root user.

Region is **`asia-south1` (Mumbai)**. MongoDB Atlas must sit in the *same*
region on GCP, or every query pays a cross-region round trip.

## One-time setup

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud config set run/region asia-south1
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
```

## Store the database URL as a secret

Never pass `MONGO_URL` with `--set-env-vars`; it contains the database
password and would be readable in the service description and deploy logs.

```bash
printf '%s' 'mongodb+srv://USER:PASSWORD@cluster.mongodb.net/?retryWrites=true&w=majority' \
  | gcloud secrets create explore91-mongo-url --data-file=-
```

To rotate it later:

```bash
printf '%s' 'NEW_CONNECTION_STRING' \
  | gcloud secrets versions add explore91-mongo-url --data-file=-
```

Grant the runtime service account read access:

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding explore91-mongo-url \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
```

## Deploy

Run from `backend/`. Cloud Build builds the image; no local Docker needed.

```bash
gcloud run deploy explore91-api \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 80 \
  --timeout 60 \
  --set-env-vars "DB_NAME=explore91,ADMIN_EMAILS=valencio@ride91.green" \
  --set-secrets "MONGO_URL=explore91-mongo-url:latest"
```

### Why `--max-instances 1`

The rate limiter in `core/security.py` keeps its sliding windows in process
memory. Cloud Run scales horizontally by default, and each new instance starts
with empty buckets — so N instances means every limit is effectively N times
looser, and the app's only abuse defence quietly stops working.

One instance is correct until Redis replaces that limiter. `--min-instances 1`
also keeps it warm, since a cold start on a feed request reads as a broken app.

Raise both numbers in the same change that introduces Redis, not before.

### Atlas network access

Cloud Run has no stable outbound IPs unless you attach a VPC connector with
Cloud NAT. Until then Atlas needs `0.0.0.0/0` allowed — access still requires
the database password. Add a VPC connector with a static egress IP when you
want to close that off.

## After deploying

```bash
gcloud run services describe explore91-api --region asia-south1 --format='value(status.url)'
curl -s https://YOUR-SERVICE-URL/api/
```

Then lock down CORS to the admin console's real origin:

```bash
gcloud run services update explore91-api --region asia-south1 \
  --update-env-vars "ALLOWED_ORIGINS=https://your-admin-host"
```
