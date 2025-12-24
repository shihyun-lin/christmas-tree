import React, { useEffect, useRef, useState } from 'react';
import { ChristmasTreeLogic } from './ChristmasTreeLogic';
import * as THREE from 'three';
import './ChristmasTreeStyles.css';

const ChristmasTreeStandalone: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const cvCanvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [loading, setLoading] = useState(true);
    const [uiHidden, setUiHidden] = useState(false);
    const treeLogicRef = useRef<ChristmasTreeLogic | null>(null);

    useEffect(() => {
        const initTree = async () => {
            if (canvasRef.current && videoRef.current && cvCanvasRef.current) {
                const logic = new ChristmasTreeLogic(
                    canvasRef.current,
                    videoRef.current,
                    cvCanvasRef.current
                );
                treeLogicRef.current = logic;

                try {
                    await logic.init();
                } catch (error) {
                    console.error("Christmas Tree Init Failed:", error);
                    // Force loading off so we can see the scene (or lack thereof)
                } finally {
                    // Hide loader
                    setTimeout(() => {
                        setLoading(false);
                    }, 2500);
                }
            }
        };

        // Try to auto-play music (Browser Policy allowing)
        const playAudio = () => {
            if (bgmRef.current) {
                bgmRef.current.volume = 0.5;
                const promise = bgmRef.current.play();
                if (promise !== undefined) {
                    promise.then(() => {
                        setIsPlaying(true);
                    }).catch(error => {
                        console.log("Auto-play prevented by browser policy. Interaction needed.");
                    });
                }
            }
        };
        setTimeout(playAudio, 1000); // 1s delay to let page stabilize

        initTree();

        return () => {
            if (treeLogicRef.current) {
                treeLogicRef.current.dispose();
            }
        };
    }, []);

    // UI Event Handlers
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === 'h') {
                setUiHidden(prev => !prev);
            }
            // Navigate Photos
            if (e.key === 'ArrowRight' && treeLogicRef.current) {
                treeLogicRef.current.navigatePhotos(1);
            }
            if (e.key === 'ArrowLeft' && treeLogicRef.current) {
                treeLogicRef.current.navigatePhotos(-1);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleResize = () => {
        if (treeLogicRef.current && treeLogicRef.current.renderer && treeLogicRef.current.camera) {
            treeLogicRef.current.camera.aspect = window.innerWidth / window.innerHeight;
            treeLogicRef.current.camera.updateProjectionMatrix();
            treeLogicRef.current.renderer.setSize(window.innerWidth, window.innerHeight);
            treeLogicRef.current.composer.setSize(window.innerWidth, window.innerHeight);
        }
    };

    useEffect(() => {
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const bgmRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    const toggleMusic = () => {
        if (bgmRef.current) {
            if (isPlaying) {
                bgmRef.current.pause();
            } else {
                bgmRef.current.play().catch(e => console.error("Audio play failed:", e));
            }
            setIsPlaying(!isPlaying);
        }
    };


    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !treeLogicRef.current) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            if (ev.target?.result) {
                new THREE.TextureLoader().load(ev.target.result as string, (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    treeLogicRef.current?.addPhoto(texture, true);
                });
            }
        };
        reader.readAsDataURL(file);
    };

    return (
        <>
            {/* Loader */}
            <div id="loader" className={loading ? '' : 'hidden'}>
                <div className="loader-spinner"></div>
                <div className="loader-text">LOADING HOLIDAY MAGIC</div>
            </div>

            {/* Title */}
            <h1 id="title">Merry Christmas</h1>

            {/* Upload Control */}
            <div className={`upload-wrapper ${uiHidden ? 'ui-hidden' : ''}`} id="upload-wrapper">
                {/* <input
                    type="file"
                    id="file-input"
                    accept="image/*"
                    style={{ display: 'none' }}
                    ref={fileInputRef}
                    onChange={handleFileChange}
                /> */}
                <button className="upload-btn" id="upload-btn" onClick={toggleMusic}>
                    {isPlaying ? 'Pause Music' : 'Play Music'}
                </button>
                <div className="upload-hint">Press 'H' to Hide Controls</div>
            </div>

            <div style={{
                position: 'fixed',
                bottom: '15px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 30,
                textAlign: 'center',
                fontFamily: "'Cinzel', serif",
                fontSize: '14px',
                color: 'rgba(212, 175, 55, 0.8)',
                textShadow: '0 0 5px rgba(212, 175, 55, 0.3)'
            }}>By svjjsjrjs</div>

            <audio ref={bgmRef} src="bgm.mp3" loop autoPlay />

            {/* Webcam for CV */}
            <div id="webcam-container">
                <video id="webcam" autoPlay playsInline ref={videoRef} muted></video>
                <canvas id="canvas" ref={cvCanvasRef}></canvas>
            </div>

            {/* Three.js Scene */}
            <canvas id="scene-canvas" ref={canvasRef}></canvas>
        </>
    );
};

export default ChristmasTreeStandalone;
