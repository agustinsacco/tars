#!/bin/sh

set -e

sudo apt-get update && sudo apt-get install -y openssl curl ca-certificates

if [ -z "$KUBE_VERSION" ]; then
    KUBE_VERSION=$(curl -L -s https://dl.k8s.io/release/stable.txt)
fi

echo "Installing Kubectl version: $KUBE_VERSION"

# Install kubectl
sudo curl -L "https://dl.k8s.io/release/$KUBE_VERSION/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl
sudo chmod +x /usr/local/bin/kubectl

# Install Kustomize
curl -s "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh" | bash
sudo mv kustomize /usr/local/bin/

if [ ! -d "$HOME/.kube" ]; then
    mkdir -p $HOME/.kube
fi

if [ ! -f "$HOME/.kube/config" ]; then
    if [ ! -z "${KUBE_CONFIG}" ]; then
        echo "$KUBE_CONFIG" | base64 -d > $HOME/.kube/config

        if [ ! -z "${KUBE_CONTEXT}" ]; then
            kubectl config use-context $KUBE_CONTEXT
        fi
    else
        echo "No authorization data found. Please provide KUBE_CONFIG or KUBE_HOST variables. Exiting..."
        exit 1
    fi
fi

# Execute all arguments
# $ARGS
