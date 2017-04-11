# update-vcs
A script that recursively update any git/svn folder

## compatibility
At least node 4

## Installation
```
npm install -g update-vcs
```

## Usage

### Display help and usage
```
update-vcs --help
```

### update everything inside a folder
```
update-vcs /the/folder/to/update
update-vcs /the/folder/to/update --verbose
```

### update every paths matching inside a folder
```
update-vcs folder match
```