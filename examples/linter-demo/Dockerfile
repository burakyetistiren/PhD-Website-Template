# Example image for a playground demo.
#   docker build -t phd-site-example-linter examples/linter-demo
#
# The site runs it as:
#   docker run --rm -i --network none --read-only --user 65534:65534 ... phd-site-example-linter python3 /app/tidylint.py -
# so keep the tool readable by any user and don't rely on writing outside /tmp.
FROM python:3.12-alpine
COPY tidylint.py /app/tidylint.py
RUN chmod 0755 /app/tidylint.py
WORKDIR /tmp
