import { StrictMode, createContext, memo, useContext, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ProgressBar, Button, Container, Row, Col, Alert, Modal, Form, Spinner } from 'react-bootstrap';

// Define API URL and base path
const apiUrl = (window.origin === 'null' || window.origin === 'http://localhost:3031') ? 'http://localhost:3030' : '';

interface ErrorType {
    id?: number,
    method?: string,
    path?: string,
    status?: number,
    statusText?: string,
    text: string,
};

interface ContextType {
    setCloseableError: (error: ErrorType) => void,
    setOtherError: (error: ErrorType) => void,
    makeRequest: (method: string, path: string, data: any, showError: boolean) => Promise<any>,
    requests: {
        getTorrentDetails: any,
        getTorrentStats: any,
    },
    refreshTorrents: () => void,
}

const AppContext = createContext<ContextType>(null);

// Interface for the Torrent API response
interface TorrentId {
    id: number;
    info_hash: string;
}

interface TorrentFile {
    name: string;
    length: number;
    included: boolean;
}

// Interface for the Torrent Details API response
interface TorrentDetails {
    info_hash: string,
    files: Array<TorrentFile>;
}

interface AddTorrentResponse {
    id: number | null;
    details: TorrentDetails;
}

// Interface for the Torrent Stats API response
interface TorrentStats {
    snapshot: {
        have_bytes: number;
        downloaded_and_checked_bytes: number;
        downloaded_and_checked_pieces: number;
        fetched_bytes: number;
        uploaded_bytes: number;
        initially_needed_bytes: number;
        remaining_bytes: number;
        total_bytes: number;
        total_piece_download_ms: number;
        peer_stats: {
            queued: number;
            connecting: number;
            live: number;
            seen: number;
            dead: number;
            not_needed: number;
        };
    };
    average_piece_download_time: {
        secs: number;
        nanos: number;
    };
    download_speed: {
        mbps: number;
        human_readable: string;
    };
    all_time_download_speed: {
        mbps: number;
        human_readable: string;
    };
    time_remaining: {
        human_readable: string;
    } | null;
}

function TorrentRow({ detailsResponse, statsResponse }) {
    const totalBytes = statsResponse.snapshot.total_bytes;
    const downloadedBytes = statsResponse.snapshot.have_bytes;
    const downloadPercentage = (downloadedBytes / totalBytes) * 100;

    return (
        <div className="torrent-row d-flex flex-row p-3 bg-light rounded mb-3">
            <Column label="Name" value={getLargestFileName(detailsResponse)} />
            <Column label="Size" value={`${formatBytesToGB(totalBytes)} GB`} />
            <ColumnWithProgressBar label="Progress" percentage={downloadPercentage} />
            <Column label="Download Speed" value={statsResponse.download_speed.human_readable} />
            <Column label="ETA" value={getCompletionETA(statsResponse)} />
            <Column label="Peers" value={`${statsResponse.snapshot.peer_stats.live} / ${statsResponse.snapshot.peer_stats.seen}`} />
        </div>
    );
}

const Column = ({ label, value }) => (
    <Col className={`column-${label.toLowerCase().replace(" ", "-")} me-3 p-2`}>
        <p className="font-weight-bold">{label}</p>
        <p>{value}</p>
    </Col>
);

const ColumnWithProgressBar = ({ label, percentage }) => (
    <Col className="column-progress me-3 p-2">
        <p className="font-weight-bold">{label}</p>
        <ProgressBar now={percentage} label={`${percentage.toFixed(2)}%`} />
    </Col>
);

const Torrent = ({ torrent }) => {
    const defaultDetails: TorrentDetails = {
        info_hash: '',
        files: []
    };
    const defaultStats: TorrentStats = {
        snapshot: {
            have_bytes: 0,
            downloaded_and_checked_bytes: 0,
            downloaded_and_checked_pieces: 0,
            fetched_bytes: 0,
            uploaded_bytes: 0,
            initially_needed_bytes: 0,
            remaining_bytes: 0,
            total_bytes: 0,
            total_piece_download_ms: 0,
            peer_stats: {
                queued: 0,
                connecting: 0,
                live: 0,
                seen: 0,
                dead: 0,
                not_needed: 0
            }
        },
        average_piece_download_time: {
            secs: 0,
            nanos: 0
        },
        download_speed: {
            mbps: 0,
            human_readable: ''
        },
        all_time_download_speed: {
            mbps: 0,
            human_readable: ''
        },
        time_remaining: {
            human_readable: ''
        }
    };

    const [detailsResponse, updateDetailsResponse] = useState(defaultDetails);
    const [statsResponse, updateStatsResponse] = useState(defaultStats);

    let ctx = useContext(AppContext);

    // Update details once
    useEffect(() => {
        if (detailsResponse === defaultDetails) {
            return loopUntilSuccess(async () => {
                await ctx.requests.getTorrentDetails(torrent.id).then(updateDetailsResponse);
            }, 1000);
        }
    }, [detailsResponse]);

    // Update stats forever.
    const update = async () => {
        const errorInterval = 10000;
        const liveInterval = 500;
        const finishedInterval = 5000;

        return ctx.requests.getTorrentStats(torrent.id).then((stats) => {
            updateStatsResponse(stats);
            return torrentIsDone(stats) ? finishedInterval : liveInterval;
        }, (e) => {
            return errorInterval
        })
    };

    useEffect(() => {
        let clear = customSetInterval(update, 0);
        return clear;
    }, []);

    return <TorrentRow detailsResponse={detailsResponse} statsResponse={statsResponse} />
}

const TorrentsList = (props: { torrents: Array<TorrentId>, loading: boolean }) => {
    if (props.torrents === null && props.loading) {
        return <Spinner />
    }
    // The app either just started, or there was an error loading torrents.
    if (props.torrents === null) {
        return <></>
    }

    if (props.torrents.length === 0) {
        return (
            <div className="text-center">
                <p>No existing torrents found. Add them through buttons below.</p>
            </div>
        )
    }
    return (
        <div>
            {props.torrents.map((t: TorrentId) =>
                <Torrent key={t.id} torrent={t} />
            )}
        </div>
    )
};

const Root = () => {
    const [closeableError, setCloseableError] = useState<ErrorType>(null);
    const [otherError, setOtherError] = useState<ErrorType>(null);

    const [torrents, setTorrents] = useState<Array<TorrentId>>(null);
    const [torrentsLoading, setTorrentsLoading] = useState(false);

    const makeRequest = async (method: string, path: string, data: any, showError: boolean): Promise<any> => {
        console.log(method, path);
        const url = apiUrl + path;
        const options: RequestInit = {
            method,
            headers: {
                'Accept': 'application/json',
            },
            body: data,
        };

        const maybeShowError = (e: ErrorType) => {
            if (showError) {
                setCloseableError(e);
            }
        }

        let error: ErrorType = {
            method: method,
            path: path,
            text: ''
        };

        let response: Response;

        try {
            response = await fetch(url, options);
        } catch (e) {
            error.text = 'network error';
            maybeShowError(error);
            return Promise.reject(error);
        }

        error.status = response.status;
        error.statusText = response.statusText;

        if (!response.ok) {
            const errorBody = await response.text();
            try {
                const json = JSON.parse(errorBody);
                error.text = json.human_readable !== undefined ? json.human_readable : JSON.stringify(json, null, 2);
            } catch (e) {
                error.text = errorBody;
            }
            maybeShowError(error);
            return Promise.reject(error);
        }
        const result = await response.json();
        return result;
    }

    const requests = {
        getTorrentDetails: (index: number): Promise<TorrentDetails> => {
            return makeRequest('GET', `/torrents/${index}`, null, false);
        },
        getTorrentStats: (index: number): Promise<TorrentStats> => {
            return makeRequest('GET', `/torrents/${index}/stats`, null, false);
        }
    };

    const refreshTorrents = async () => {
        setTorrentsLoading(true);
        let torrents: { torrents: Array<TorrentId> } = await makeRequest('GET', '/torrents', null, false).finally(() => setTorrentsLoading(false));
        setTorrents(torrents.torrents);
        return torrents;
    };

    useEffect(() => {
        let interval = 500;
        let clear = customSetInterval(async () => {
            try {
                await refreshTorrents();
                setOtherError(null);
                return interval;
            } catch (e) {
                setOtherError(e);
                console.error(e);
                return 5000;
            }
        }, interval);
        return clear;
    }, []);

    const context: ContextType = {
        setCloseableError,
        setOtherError,
        makeRequest,
        requests,
        refreshTorrents,
    }

    return <AppContext.Provider value={context}>
        <RootContent closeableError={closeableError} otherError={otherError} torrents={torrents} torrentsLoading={torrentsLoading} />
    </AppContext.Provider >
}

const Error = (props: { error: ErrorType, remove?: () => void }) => {
    let { error, remove } = props;

    if (error == null) {
        return null;
    }

    return (<Alert variant='danger'>
        {error.method && (
            <strong>Error calling {error.method} {error.path}: </strong>
        )}
        {error.status && (
            <strong>{error.status} {error.statusText}: </strong>
        )}
        {error.text}
        {
            remove && (
                <button type="button" className="close" data-dismiss="alert" aria-label="Close" onClick={remove}>
                    <span aria-hidden="true">&times;</span>
                </button>
            )
        }
    </Alert>);
};

const UploadButton = ({ buttonText, onClick, data, setData, variant }) => {
    const [loading, setLoading] = useState(false);
    const [fileList, setFileList] = useState(null);
    const ctx = useContext(AppContext);
    const showModal = data !== null;

    // Get the torrent file list if there's data.
    useEffect(() => {
        if (data === null) {
            return;
        }

        let t = setTimeout(async () => {
            try {
                const response: AddTorrentResponse = await ctx.makeRequest('POST', `/torrents?list_only=true&overwrite=true`, data, true);
                console.log(response);
                setFileList(response.details.files);
            } catch (e) {
                clear();
            } finally {
                setLoading(false);
            }
        }, 0);
        return () => clearTimeout(t);
    }, [data]);

    const clear = () => {
        setData(null);
        setFileList(null);
        setLoading(false);
    }

    return (
        <>
            <Button variant={variant} onClick={onClick}>
                {buttonText}
            </Button>

            <FileSelectionModal
                show={showModal}
                onHide={clear}
                fileList={fileList}
                data={data}
                fileListLoading={loading}
            />
        </>
    );
};

const MagnetInput = () => {
    let [magnet, setMagnet] = useState(null);

    const onClick = () => {
        const m = prompt('Enter magnet link or HTTP(s) URL');
        setMagnet(m === '' ? null : m);
    };

    return (
        <UploadButton variant='primary' buttonText="Add Torrent from Magnet Link" onClick={onClick} data={magnet} setData={setMagnet} />
    );
};

const FileInput = () => {
    const inputRef = useRef<HTMLInputElement>();
    const [file, setFile] = useState(null);

    const onFileChange = async () => {
        const file = inputRef.current.files[0];
        setFile(file);
    };

    const onClick = () => {
        inputRef.current.click();
    }

    return (
        <>
            <input type="file" ref={inputRef} accept=".torrent" onChange={onFileChange} className='d-none' />
            <UploadButton variant='secondary' buttonText="Upload .torrent File" onClick={onClick} data={file} setData={setFile} />
        </>
    );
};

const FileSelectionModal = (props: { show: boolean, onHide, fileList: Array<TorrentFile> | null, fileListLoading: boolean, data }) => {
    let { show, onHide, fileList, fileListLoading, data } = props;


    const [selectedFiles, setSelectedFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);

    useEffect(() => {
        setSelectedFiles((fileList || []).map((_, id) => id));
    }, [fileList]);

    fileList = fileList || [];

    let ctx = useContext(AppContext);

    const handleToggleFile = (fileIndex: number) => {
        if (selectedFiles.includes(fileIndex)) {
            setSelectedFiles(selectedFiles.filter((index) => index !== fileIndex));
        } else {
            setSelectedFiles([...selectedFiles, fileIndex]);
        }
    };

    const handleUpload = async () => {
        const getSelectedFilesQueryParam = () => {
            let allPresent = true;
            fileList.map((_, id) => {
                allPresent = allPresent && selectedFiles.includes(id);
            });
            return allPresent ? '' : '&only_files=' + selectedFiles.join(',');
        };

        let url = `/torrents?overwrite=true${getSelectedFilesQueryParam()}`;

        ctx.makeRequest('POST', url, data, false).then(() => { onHide() }, (e) => {
            setUploadError(e);
        })
    };

    return (
        <Modal show={show} onHide={onHide}>
            <Modal.Header closeButton>
                <Modal.Title>Select Files</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                {fileListLoading ? (
                    <Spinner animation="border" role="status">
                        <span className="sr-only">Loading...</span>
                    </Spinner>
                ) : (
                    <Container>
                        {fileList.map((file, index) => (
                            <Row key={index}>
                                <Col>
                                    <Form.Check
                                        type="checkbox"
                                        label={`${file.name} ${formatBytesToGB(file.length)}`}
                                        checked={selectedFiles.includes(index)}
                                        onChange={() => handleToggleFile(index)}
                                    />
                                </Col>
                            </Row>
                        ))}
                        <Error error={uploadError} />
                    </Container>
                )}
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" onClick={onHide}>
                    Cancel
                </Button>
                <Button variant="primary" onClick={handleUpload} disabled={fileListLoading || uploading || selectedFiles.length == 0}>
                    OK
                </Button>
            </Modal.Footer>
        </Modal>
    );
};

const Buttons = () => {
    return (
        <div id="buttons-container" className="mt-3">
            <MagnetInput />
            <FileInput />
        </div>
    );
};

const RootContent = (props: { closeableError: ErrorType, otherError: ErrorType, torrents: Array<TorrentId>, torrentsLoading: boolean }) => {
    let ctx = useContext(AppContext);
    return <Container>
        <Error error={props.closeableError} remove={() => ctx.setCloseableError(null)} />
        <Error error={props.otherError} />
        <TorrentsList torrents={props.torrents} loading={props.torrentsLoading} />
        <Buttons />
    </Container>
};

function torrentIsDone(stats: TorrentStats): boolean {
    return stats.snapshot.have_bytes == stats.snapshot.total_bytes;
}

// Render function to display all torrents
async function displayTorrents() {
    // Get the torrents container
    const torrentsContainer = document.getElementById('output');
    const RootMemo = memo(Root, (prev, next) => true);
    ReactDOM.createRoot(torrentsContainer).render(<StrictMode><RootMemo /></StrictMode>);
}

// Function to format bytes to GB
function formatBytesToGB(bytes: number): string {
    const GB = bytes / (1024 * 1024 * 1024);
    return GB.toFixed(2);
}

// Function to get the name of the largest file in a torrent
function getLargestFileName(torrentDetails: TorrentDetails): string {
    if (torrentDetails.files.length == 0) {
        return 'Loading...';
    }
    const largestFile = torrentDetails.files.reduce((prev: any, current: any) => (prev.length > current.length) ? prev : current);
    return largestFile.name;
}

// Function to get the completion ETA of a torrent
function getCompletionETA(stats: TorrentStats): string {
    if (stats.time_remaining) {
        return stats.time_remaining.human_readable;
    } else {
        return 'N/A';
    }
}

function customSetInterval(asyncCallback: any, interval: number) {
    let timeoutId: number;
    let currentInterval: number = interval;

    const executeCallback = async () => {
        currentInterval = await asyncCallback();
        if (currentInterval === null || currentInterval === undefined) {
            throw 'asyncCallback returned null or undefined';
        }
        scheduleNext();
    }

    let scheduleNext = () => {
        timeoutId = setTimeout(executeCallback, currentInterval);
    }

    scheduleNext();

    let clearCustomInterval = () => {
        clearTimeout(timeoutId);
    }

    return clearCustomInterval;
}

function loopUntilSuccess(callback, interval: number) {
    let timeoutId: number;

    const executeCallback = async () => {
        let retry = await callback().then(() => { false }, () => { true });
        if (retry) {
            scheduleNext();
        }
    }

    let scheduleNext = (i?: number) => {
        timeoutId = setTimeout(executeCallback, i !== undefined ? i : interval);
    }

    scheduleNext(0);

    let clearCustomInterval = () => {
        clearTimeout(timeoutId);
    }

    return clearCustomInterval;
}

// List all torrents on page load and set up auto-refresh
async function init(): Promise<void> {
    await displayTorrents();
}

// Call init function on page load
document.addEventListener('DOMContentLoaded', init);