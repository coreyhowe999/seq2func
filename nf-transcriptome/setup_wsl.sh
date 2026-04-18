#!/bin/bash
set -e

export JAVA_HOME=/opt/java/jdk-21.0.10+7
export PATH=$JAVA_HOME/bin:$PATH

# Install Java directly from tar
if ! java -version 2>/dev/null; then
    echo "Installing Java..."
    cd /tmp
    if [ ! -f OpenJDK21U-jdk_x64_linux_hotspot_21.0.10_7.tar.gz ]; then
        wget -q "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jdk_x64_linux_hotspot_21.0.10_7.tar.gz"
    fi
    sudo mkdir -p /opt/java
    sudo tar xzf OpenJDK21U-jdk_x64_linux_hotspot_21.0.10_7.tar.gz -C /opt/java/
fi

echo "Java: $(java -version 2>&1 | head -1)"

# Install Nextflow
if [ ! -f /usr/local/bin/nextflow ]; then
    echo "Installing Nextflow..."
    cd /tmp
    curl -s https://get.nextflow.io | bash
    sudo mv nextflow /usr/local/bin/
fi

echo "Nextflow: $(nextflow -version 2>&1 | grep version)"
echo "Docker: $(docker --version 2>&1)"
echo "SETUP DONE"
