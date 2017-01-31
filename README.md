# Board of Dashed Hopes

A concourse status aggregator.

## Setup

You have three options:

1. Deploy the Spring Boot app anywhere, and set the zuul.routes.concourse.url to point to your concourse
2. Serve the files under `src/main/resources/static` from the same origin as your Concourse API
3. Set up your conourse API to be served with CORS headers that allow access from wherever you serve the files under 
   `src/main/resources/static`.

